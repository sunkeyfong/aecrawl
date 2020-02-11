#! /usr/bin/env node
const args = require('yargs')
    .usage('Usage:aecrawl [options] ..args')
    .help('h')
    .argv;
const fn =  require( './' + args._.shift() );
(async () => {
    
    console.time('task-duration')
    await fn.call( fn, args )
    console.timeEnd('task-duration');
    process.exit(0);

})();