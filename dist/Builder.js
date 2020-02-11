/**
 * 从抓取的数据重建hotels表
 */
const MongoClient = require('mongodb').MongoClient
const DEFAULT_CONFIG = {
    pkey : 'id',
    // 后提取的集合字段会覆盖之前提取的
    maps : {
        'hotel_album_web' : { pictures : 'photos', 'count' : 'comment_count' },
    },
    mongodb : {
        url : 'mongodb://localhost:27017',
        options : { useNewUrlParser: true, useUnifiedTopology: true },
        db : 'ctrip',
        collection : 'hotels'
    }
}

module.exports = class Hotel{

    constructor( config = {} ){
        this.config = Object.assign( {}, DEFAULT_CONFIG, config )
    }

    async run( selector = {} ){
        this.selector = selector
        this.$db = this.$db || await MongoClient.connect( this.config.mongodb.url, this.config.mongodb.options ).then( client => client.db( this.config.mongodb.db ) )
        for( let clt in this.config.maps ){
            console.group( clt )
            if( this[clt] ) await this[clt]()
            else await this.collect( clt )
            console.groupEnd()
        }
    }

    async collect( clt ){
        const cursor = this.$db.collection( clt ).find( this.selector )
        var doc = await cursor.next()
        while( doc ){
            doc['_refer_'+clt] = doc._id
            delete doc._id
            try{
                await this.extract( doc, this.config.maps[clt] )
            }catch(e){
                console.error( e, doc['_refer_'+clt] )
            }
            doc = await cursor.next()
        }
    }
    
    /**
     * map中未包含的值不被提存
     */
    async extract( json, map ){
        const collection = this.$db.collection( this.config.mongodb.collection )
        const _id = json[ this.config.pkey ]
        if( !_id ) throw( 'no primary key')

        const doc = {}
        for( let k in map ){
            doc[map[k]] = json[k]
        }
        await collection.updateOne( { _id : _id }, { $set : doc }, { upsert: true } )
    }

}