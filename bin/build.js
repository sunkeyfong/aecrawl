/**
 * 实例化Page并执行抓取
 */
module.exports = async( args )=>{
    const $builder = new ( require( process.cwd() + '/' + args._.shift() ) )
    delete args._
    delete args.$0
    await $builder.run.call( $builder, args )
}