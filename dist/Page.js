const fso = require('fs')
const fs = fso.promises
const path = require('path')
const puppeteer = require('puppeteer')
const deepmerge = require('deepmerge')
const devices = require('puppeteer/DeviceDescriptors')
const temme = require('temme').default
const MongoClient = require('mongodb').MongoClient;

const DEFAULT_PAGE_CONFIG = {
    extract_rule : null, //rule文件path，如果指定将在run后自动extract
    args : [],  //指定参数的key
    //用于extract
    // mongodb : {
    //     url : 'mongodb://localhost:27017',
    //     options : { useNewUrlParser: true, useUnifiedTopology: true },
    //     db : 'ctrip',
    //     collection : 'hotel_album_web',
    // },
    //用于puppeteer.launch
    browser : {
        //使可见便于调试
        // headless : false,
        // devtools : true,
        args: ['--disable-infobars'],
        ignoreDefaultArgs : ['--enable-automation'],
    },
    page : {
        forbid : [],    //屏蔽正则匹配的请求
        //emulate : 'iPhone X'  指定模拟的设备
        //捕获请求数据
        catch : [
        //     {
        //         url : 'https://sec-m.ctrip.com/restapi/soa2/12530/json/availableCityListQOC',
        //         method : 'POST',
        //         as : 'api_city_list'
        //     }
        ],
    },

    //@todo catch : [ match => handler( response ) ]    //捕获正则匹配的请求的返回并执行操作
    //@todo? screenshot : false,
}

/**
 * Contract Crawler
 * 定义Crawler的协议
 * 
 * 基本使用方法
 * const detail = new Detail( config )  //将开启新浏览器、新页面
 * await detail.apply( detail , args )
 * console.log( detail.html )
 * await detail.apply( detail , args2 )
 * console.log( detail.html )
 * 
 */
module.exports = class Page{

    /**
     * @override
     */
    get html(){ return  __dirname + '/' +this.constructor.name + '/' + (new Date()).getTime() + '.html' }

    async action( ...args ){ /** 使页面数据充分展示或补充抓取内容 */ }
    async decorateExtract( data ){ return data }    //extract前修改数据

    /**
     * @override super(config)设定不同的config
     * @param config 设置
     * @return { Page } page
     */
    constructor( config = {} ){
        this.config = deepmerge( DEFAULT_PAGE_CONFIG, config )
        this.args = {}
        this.apiData = {}
    }

    /**
     * 抓取页面
     * - 提供过：如果同id文件已存在则跳过
     * - 更新this.args
     * - 若无browser将开启新实例
     * - 若无page将开启新实例
     * @param args 继承类要求的参数, 见 this.config.args
     */
    async run( ...args ){
        this.config.args.forEach( (n,k) => this.args[n] = args[k] )
        //抓取网页
        if( fso.existsSync( this.html ) ) console.log('[skip crawl] 已存在', this.html)
        else{
            console.log('crawling..')
            await this.__init()
            await this.action.apply( this, args )
            console.log('saving..')
            await this.__saveContent()
        }
        //提存数据
        await this.__extract()
        return this
    }

    async __init(){
        await this.__makePath( path.dirname( this.html ) )
        this.$browser = this.$browser || await puppeteer.launch( this.config.browser );
        //设置页面
        if( !this.$page ){
            this.$page = await this.$browser.newPage();
            if( this.config.page.emulate ) await this.$page.emulate( devices[ this.config.page.emulate ] )
            await this.$page.setBypassCSP(true)  //设置绕过安全策略
            await this.$page.setRequestInterception(true) //启用请求拦截
            this.__setForbids()
            this.__setCatches()
        }
    }

    __setForbids(){
        if( this.config.page.forbid.length < 1 ) return this.$page.on('request', request => request.continue()  )
        this.$page.on('request', request => {
            for( let reg of this.config.page.forbid ){
                if( request.url().match( reg ) ){ return request.abort() }
            }
            return request.continue()
        });
    }
    __setCatches(){
        if( this.config.page.catch.length < 1 ) return
        this.$page.on('response', response => {
            for( let c of this.config.page.catch ){
                if( response.request().method() == c.method && response.request().url().match( c.url ) ){
                    let $p = this
                    try{
                        response.json().then(json =>  $p.apiData[c.as] = json)
                    }catch(e){
                        response.text().then( text => $p.apiData[c.as] = text )
                    }
                }
            }
        });
    }

    //迭代创建目录
    async __makePath( curr ){
        let dirs = []
        while( !fso.existsSync(curr) ){
            dirs.unshift( curr )
            curr = path.dirname( curr )
        }
        for( let d of dirs ) await fs.mkdir( d )
    }

    /**
     * 保存页面html文件
     */
    async __saveContent(){
        await fs.writeFile( this.html, await this.$page.content() )
        console.log('saved file '+ this.html)
        return this
    }

    /**
     * 提取保存后的页面数据到db
     * - 跳过：如果db中已存在同_html的数据则跳过
     */
    async __extract(){
        if( !this.config.mongodb ) return console.log('[skip extract]','未设置db')

        if( !this.$collection ) this.$collection = await MongoClient.connect( this.config.mongodb.url, this.config.mongodb.options ).then( client => client.db( this.config.mongodb.db ).collection( this.config.mongodb.collection ) )

        //已存在则跳过
        if( await this.$collection.findOne({ _html : this.html }) ) return console.log('[skip extract] 已存在')

        let data = Object.assign( {}, this.apiData, this.temme( this.html ) )
        data._html = this.html
        data._html_mtime = new Date(fso.statSync( this.html ).mtime)

        if( this.decorateExtract ) data = await this.decorateExtract(data)
        await this.$collection.insertOne( data )
        console.log(`saved mongodb ${this.config.mongodb.db}/${this.config.mongodb.collection}`)

        return this
    }
    
    /**
     * 使用Page定义的rule解析数据
     */
    async temme( htmlFile = null ){
        if( !this.config.extract_rule ) { console.log('[skip temme]','rule文件未定义'); return null }
        this.rule = this.rule || await fs.readFile( this.config.extract_rule ,'UTF-8' )
        const html = await fs.readFile( htmlFile || this.html ,'UTF-8' )
        return temme( html , this.rule )
    }

}