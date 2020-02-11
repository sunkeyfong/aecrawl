/**
 * 实例化Page并执行抓取
 */
module.exports = async( args )=>{
    const $page = new ( require( process.cwd() + '/' + args._.shift() ) )
    var argsArr= []
    if( args.argsProvider ){
        console.log('[批量抓取]')
        argsArr = await require( process.cwd() + '/' + args.argsProvider )()
    }else argsArr = [ args._ ]

    for( let i in argsArr ){
        console.group( ( parseInt(i)+1 ) + '/' + argsArr.length )
        try{ await $page.run.apply( $page, argsArr[i] ) }
        catch(e){
            console.error( new Error(e) )
            console.log('[ 重启chromiun继续 ]')
            await $page.$browser.close()
            $page.$browser = null
            $page.$page = null
            await $page.run.apply( $page, argsArr[i] )
        }
        console.groupEnd()
    }
    
}