> 基于nodejs环境的一套简单的网页抓取及数据提取功能包

aecrawl主要功能依赖：
- 1. puppeteer : 实现网页抓取功能
- 2. temme : 实现网页html文件提取成json
- 3. mongodb : 将json数据保存到mongodb

# 安装

```npm install -g aecrawl ```

# 抓取页面数据

aecrawl包含命令行工具及规则类两部分，我们需要继承规则类**实现自己的规则**，然后**使用命令行工具执行抓取**。

#### 1、 定义Page抓取规则

```javascript
// imdb/FilmDetailWeb.js

const { Page } = require('aecrawl')
//配置说明
const config = {
    //类需要使用的参数，可以通过 this.args.id 获取
    args : ['id'],
    //初始headless浏览器的设置（见 puppeteer.launch ）
    browser : { devtools : true },
    //aecrawl封装的浏览器页面辅助行为
    page : {
        //屏蔽页面中url正则匹配'check','antibot'的所有请求
        fobid : ['check','antibot']
    },
    //设置以下2项后，网页保存本地html文件后会自动使用temme提取json保存到mongodb
    extract_rule : __dirname + '/FilmDetailWeb.tm',  //temme规则文件（语法见 temme)
    mongodb : {
        url : 'mongodb://localhost:27017',
        options : { useNewUrlParser: true, useUnifiedTopology: true },
        db : 'imdb',
        collection : 'film_detail_web',
    },
}

//（我通常以 [对象][来源页类型][端]来命名）
module.exports = class FilmDetailWeb extends Page{

    //设定保存html文件的名称及保存路劲
    get id(){ return this.args.id }
    get folder(){ return __dirname + '/data' }

    //传入配置
    constructor(){ super(config) }

    //Page.run会在初始化浏览器及页面后会执行这个方法，并在之后保存html及mongodb
    async action(){
        const url = `http://www.imdb.cn/title/tt${this.args.id}`
        await this.$page.goto( url )
    }

    //存到mongodb前修改temme提取的数据
    async decorateExtract( data ){
        data.id = this.args.id
        return data
    }
}
```

#### 2、定义html数据提取规则

aecrawl使用temme进行html的数据提取，详见[shinima/temme](https://github.com/shinima/temme.git)

```less
// imdb/FilmDetailWeb.tm
h3{$title}
div.fk-4 .bdd{$description}
div.fk-3 .hdd span i{$comment|Number}
```

#### 3、抓取页面

抓取id为0137523的网页，保存html为./data/0137523.html，并使用temme提取数据保存到mongodb.imdb.films

```javascript
const $film = new FilmDetailWeb
await $film.run(0137523)
await $film.run(0293827)    //通常来讲，可以直接复用页面实例继续抓取下参数对应的页面
...
```

当然你也可以直接在命令行执行```$ aecrawl page ./imdb/FilmDetailWeb.js 0137523```

#### 4、批量抓取

aecrawl提供批量抓取的命令行工具，在使用前您还需要提供一个脚本提供不同args供Page执行

```javascript
// imdb/argsProvider.js
(async ()=>{
    return [ 0137523, 0137523 , ..] //通常是从列表页或mongodb中获取，逐个抓取
})()
```

命令行以argsProvider返回数组中的每个值为args传入run()进行抓取

```$ aecrawl page ./imdb/FilmDetailWeb.js --argsProvider ./imdb/argsProvider.js ```

# 合成数据

可能对于同一条数据如film，您可能会从不同的页面获取其不同的字段，这个时候你可以使用**aecrawl.Builder**来合成相关mongodb.collection中的数据

#### 1、定义合成规则

```javascript
// imdb/FilmBuilder.js

const { Builder } = require('aecrawl')

//配置说明
const DEFAULT_CONFIG = {
    //所有集合document需包含这个字段并以此合并（自定义合并的集合除外）
    //将会以此键值为新doc._id
    pkey : 'id',
    maps : {
        //集合名 : 字段映射，仅列出的字段会保存到最终数据中
        'film_detail_web' : {
            name : 'name',
            description : 'description',
            comment : 'comment_score',
        },
        'film_comment_web' : {
            comment_count : 'comment_count',
            comment_score : 'comment_score',
        },
        'film_list_web' : {
            cover : 'cover'
        },
    },
    mongodb : { //从这儿获取上述集合
        url : 'mongodb://localhost:27017',
        options : { useNewUrlParser: true, useUnifiedTopology: true },
        db : 'imdb',
        collection : 'hotels'   //最终数据存到这个集合
    }
}

module.exports = class FilmBuilder extends Builder{

    constructor(){
        super( DEFAULT_CONFIG )
    }

    //以集合名为方法名，自定义合并方法
    async film_list_web(){
        const cursor = this.$db.collection('hotel_list_m').find( this.selector )
        var doc = await cursor.next()
        while( doc ){
            for( let h of doc.hotels ){
                h['_refer_film_list_web'] = doc._id     //合成的数据都会加上 _refer_集合 = _id 的字段，这里也加上
                await this.extract( h, this.config.maps['hotel_list_m'] )   //调用extract方法保存数据
            }
            doc = await cursor.next()
        }
    }

}
```

#### 执行合成

```javascript
const filmBuilder = new FilmBuilder
await filmBuilder.run({ rate : 5 })     //仅合成film_detail_web中rate=5的数据
```

同样可以使用命令行```$ aecrawl build ./imdb/FilmBuilder.js --rate 5```

# credits

* [mongodb](https://github.com/mongodb/node-mongodb-native)
* [puppeteer](https://github.com/puppeteer/puppeteer)
* [temme](https://github.com/shinima/temme.git)

特别感谢temme，一个精彩的库！
