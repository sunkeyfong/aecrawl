const fso = require('fs')
const fs = fso.promises
const puppeteer = require('puppeteer')
const temme = require('temme').default
const MongoClient = require('mongodb').MongoClient;

const DEFAULT_PAGE_CONFIG = {
    extract_rule : null, //rule文件path，如果指定将在run后自动extract
    args : ['key'],  //指定参数的key
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
 * console.log( detail.data.html )
 * await detail.apply( detail , args2 )
 * console.log( detail.data.html )
 * 
 */
module.exports = class Page{

    /**
     * @override
     */
    get id(){ return this.args.join('-') }
    get folder(){ return __dirname + '/' +this.constructor.name  }

    async action( ...args ){ /** 使页面数据充分展示或补充抓取内容 */ }
    async decorateExtract( data ){ return data }    //extract前修改数据

    /**
     * @override super(config)设定不同的config
     * @param config 设置
     * @return { Page } page
     */
    constructor( config = {} ){
        this.config = Object.assign( DEFAULT_PAGE_CONFIG, config )
        this.args = {}
    }

    get data(){
        return {
            html : this.folder + '/' + this.id  + '.html'
        }
    }

    /**
     * 抓取页面
     * - 提供过：如果同id文件已存在则跳过
     * - 更新this.id
     * - 更新this.args
     * - 若无browser将开启新实例
     * - 若无page将开启新实例
     * @param args 继承类要求的参数, 见 this.config.args
     */
    async run(...args ){
        this.config.args.forEach( (n,k) => this.args[n] = args[k] )
        //抓取网页
        if( fso.existsSync( this.data.html ) ){
            console.log('[skip crawl]')
        }else{
            console.log('crawling..')
            await this.__init()
            await this.action.apply( this, args )
            console.log('saving..')
            await this.__saveContent()
        }
        //提存数据
        if( !this.config.mongodb ){
            console.log('[skip extract]','未设置db')
        }else{
            this.$collection = this.$collection
                || await MongoClient.connect( this.config.mongodb.url, this.config.mongodb.options ).then( client => client.db( this.config.mongodb.db ).collection( this.config.mongodb.collection ) )
            await this.extract( this.data.html, this.$collection )
        }
        return this
    }

    async __init(){
        await this.__makePath()
        this.$browser = this.$browser || await puppeteer.launch( this.config.browser );
        //设置页面
        if( !this.$page ){
            this.$page = await this.$browser.newPage();
            await this.$page.setBypassCSP(true)  //设置绕过安全策略
            this.__setForbids()
        }
    }
    __setForbids(){
        if( this.config.page.fobid.length < 1 ) return
        console.log('forbid', this.config.page.fobid)
        this.$page.setRequestInterception(true)
        this.$page.on('request', request => {
            for( let reg of this.config.page.fobid ){
                if( request.url().match( reg ) ){ return request.abort() }
            }
            return request.continue()
        });
    }
    async __makePath(){
        if( !fso.existsSync( this.folder ) ){
            console.error('create folder');
            await fs.mkdir( this.folder )
        }
    }

    /**
     * 保存页面html文件
     */
    async __saveContent(){
        await fs.writeFile( this.data.html, await this.$page.content() )
        console.log('saved file '+ this.data.html)
        return this
    }

    /**
     * 提取保存后的页面数据到db
     * - 跳过：如果db中已存在同_html的数据则跳过
     * @param { String } htmlFile html文件path
     */
    async extract( htmlFile, $clt ){
        if( !this.config.extract_rule ) return console.log('[skip extract]','rule文件未定义')

        //已存在则跳过
        if( $clt ){
            let data = await $clt.findOne({ _html : htmlFile })
            if( data ){ console.log('[skip extract]'); return data }
        }

        //解析并保存
        this.rule = this.rule || await fs.readFile( this.config.extract_rule ,'UTF-8' )
        const html = await fs.readFile( htmlFile ,'UTF-8' )
        data = temme( html , this.rule )
        data._html = htmlFile
        data._html_mtime = new Date(fso.statSync( this.data.html ).mtime)

        if( this.decorateExtract ) data = await this.decorateExtract(data)
        if( $clt ){
            await $clt.insertOne( data )
            console.log(`saved mongodb ${this.config.mongodb.db}/${this.config.mongodb.collection}`)
        }
        return data
    }

}