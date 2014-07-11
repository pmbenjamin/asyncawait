var path = require('path');
var async = require('async'); // NB: async is used here in the benchmarking code, in case co or
                              // asyncawait won't run on the version of node being benchmarked.
var _ = require('lodash');
var rewire = require('rewire');
try { var memwatch = require('memwatch'); } catch(e){}


// Functions available for benchmarking.
var functions = {
    countFiles: 'countFiles',
    fibonacci: 'fibonacci',
    largest: 'largest'

};

// Variants available for benchmarking.
var variants = {
    async: 'async',
    asyncawait: 'asyncawait',
    asyncawait2: 'asyncawait-iterators',
    bluebird: 'bluebird',
    callbacks: 'callbacks',
    co: 'co',
    synchronous: 'synchronous'
};


// ================================================================================
// Benchmark configuration - adjust to suit.

var SELECTED_FUNCTION = functions.largest;

var SELECTED_VARIANT = variants.asyncawait;

var SAMPLES_PER_RUN = 1000;   // How many times the function will be called per run.

var RUNS_PER_BENCHMARK = 25;  // How many runs make up the whole benchmark.

var CONCURRENCY_FACTOR = 10;  // Max number of concurrent invocations of the function.

// Some additional switches
var JUST_CHECK_THE_FUNCTION = false;            // If true, just call the function once and display its results.
var USE_SAME_SYMBOL_FOR_ALL_SAMPLES = true;     // If true, all samples will use the same symbol ('.'). Otherwise, concurrent samples will use distinct symbols.
//TODO: mockfs not working - check with largest-asyncawait with JUST_CHECK_THE_FUNCTION=true
var USE_MOCK_FS = false;                        // If true, uses a mocked 'fs' module returning fixed in-memory results.
var COMPARE_WITH_VARIANT = variants.callbacks;  // If non-null, re-run the benchmark with the given variant and show the relative results.
var OUTPUT_GC_STATS = false;                    // If true, indicate GC pauses and statistics, and indicate possible memory leaks.
var OUTPUT_SAMPLES_PER_SEC_SUMMARY = true;     // If true, print all samples/sec numbers at the end, to export for anaysis (eg for charting).

// ================================================================================


// Set up memory diagnostics
OUTPUT_GC_STATS = OUTPUT_GC_STATS && memwatch;
var fullGCs = 0;
var incrGCs = 0;
var leaked = 0;
if (OUTPUT_GC_STATS) {
    memwatch.on('leak', function(info) {
        leaked += info.growth;
        process.stdout.write(' [LEAK+' + info.growth +'] ');
    });
    memwatch.on('stats', function(stats) {
        fullGCs = stats.num_full_gc;
        incrGCs = stats.num_inc_gc;
        process.stdout.write(' [GC] ');
    });
}


// Run the benchmark (or just check the function).
if (JUST_CHECK_THE_FUNCTION) {
    var name = SELECTED_FUNCTION + '-' + SELECTED_VARIANT;
    var sample = createSampleFunction();
    console.log("========== CHECKING '" + name + "': ==========");
    sample(function(err, result) {
        console.log(err || result);
        if (OUTPUT_GC_STATS) {
            console.log("========== GCs: " + fullGCs + 'full/' + incrGCs + "incr ==========");
            console.log("========== Leaked: " + leaked + " ==========");
        }
    });
}
else if (COMPARE_WITH_VARIANT) {
    benchmark(function (err, result1) {
        if (err) return;
        SELECTED_VARIANT = COMPARE_WITH_VARIANT;
        console.log('\n\n\n');
        benchmark(function (err, result2) {
            if (err) return;
            console.log('\n\n========== Comparison ==========');
            console.log('1st: ' + result1.samplesPerSec + ' sampes/sec   2nd: ' + result2.samplesPerSec + 'sampes/sec');
            if (result1.samplesPerSec > result2.samplesPerSec) {
                console.log('100% vs ' + Math.round(100 * result2.samplesPerSec / result1.samplesPerSec) + '%');
            }
            else {
                console.log(Math.round(100 * result1.samplesPerSec / result2.samplesPerSec) + '% vs 100%');
            }

        });
    });
}
else {
    benchmark(function () {});
}


function benchmark(callback) {
    var name = SELECTED_FUNCTION + '-' + SELECTED_VARIANT;
    var sample = createSampleFunction();
    var allSamplesPerSec = [];
    console.log('========== PERFORMING ' + RUNS_PER_BENCHMARK + " RUNS ON '" + name + "': ==========\n");
    var times = [];
    async.timesSeries(
        RUNS_PER_BENCHMARK,
        function (n, next) {
            process.stdout.write('RUN ' + (n + 1));
            run(sample, function (err, timing) {
                if (err) {
                    next(err);
                } else {
                    times.push(timing.totalElapsed);
                    allSamplesPerSec.push(SAMPLES_PER_RUN * 1000.0 / timing.totalElapsed);
                    var msg = SAMPLES_PER_RUN
                        + ' samples took '
                        + (timing.totalElapsed / 1000.0)
                        + ' seconds ('
                        + (SAMPLES_PER_RUN * 1000.0 / timing.totalElapsed)
                        + ' samples/sec), average latency per sample: '
                        + timing.perSample
                        + 'ms';
                    if (OUTPUT_GC_STATS) {
                        msg = msg
                            + ', GCs: '
                            + timing.fullGCs
                            + 'full/'
                            + timing.incrGCs
                            + 'incr, leaked: '
                            + timing.leaked;
                    }
                    console.log(msg + '\n');
                    next();
                }
            });
        },
        function (err) {
            if (err) {
                console.log(err);
                return callback(err);
            } else {
                totalTime = _.reduce(times, function (sum, time) { return sum + time; });
                var averageTime = totalTime / RUNS_PER_BENCHMARK;
                    var msg = 'Average time: '
                        + (averageTime / 1000.0)
                        + ' seconds ('
                        + (SAMPLES_PER_RUN * 1000.0 / averageTime)
                        + ' samples/sec)';
                console.log('========== ' + msg + ' ==========');
                if (OUTPUT_GC_STATS) {
                    console.log("========== GCs: " + fullGCs + 'full/' + incrGCs + "incr ==========");
                    console.log("========== Leaked: " + leaked + " ==========");
                }
                if (OUTPUT_SAMPLES_PER_SEC_SUMMARY) {
                    console.log("========== Summary of samples/sec for all runs: ==========");
                    console.log(allSamplesPerSec.join(', '));
                }
                return callback(null, {
                    times: times,
                    totalTime: totalTime,
                    averageTime: averageTime / 1000.0,
                    samplesPerSec: SAMPLES_PER_RUN * 1000.0 / averageTime
                });
            }
        });
}



function run(sample, callback) {
    var chars = USE_SAME_SYMBOL_FOR_ALL_SAMPLES ? '.' : './#$@%^&*+!=-?~`|()[]ABCDEFGHIJKLMNOPQRS';
    var start = new Date().getTime();
    var startFullGCs = fullGCs;
    var startIncrGCs = incrGCs;
    var startLeaked = leaked;
    var sumOfTimePerSample = 0.0;
    async.times(
        CONCURRENCY_FACTOR,
        function (m, nextOuter) {
            var char = chars.charAt(m % chars.length);
            async.timesSeries(
                1.0 * SAMPLES_PER_RUN / CONCURRENCY_FACTOR,
                function (n, nextInner) {
                    var start = new Date().getTime();
                    sample(function() {
                        process.stdout.write(char);
                        var end = new Date().getTime();
                        sumOfTimePerSample += (end - start);
                        nextInner();
                    });
                },
                function (err) {
                    nextOuter(err);
                }
            );
        },
        function(err, res) {
            process.stdout.write('\n');
            if (err) { callback(err); return; }
            var perSample = sumOfTimePerSample / SAMPLES_PER_RUN;
            var totalElapsed = new Date().getTime() - start;
            callback(null, {
                perSample: perSample,
                totalElapsed: totalElapsed,
                fullGCs: fullGCs - startFullGCs,
                incrGCs: incrGCs - startIncrGCs,
                leaked: leaked - startLeaked
            });
        }
    );
};


function createSampleFunction() {
    var moduleId = './' + SELECTED_FUNCTION + '/' + SELECTED_FUNCTION + '-' + SELECTED_VARIANT;
    var selectedFunction = rewire(moduleId);
    if (USE_MOCK_FS) selectedFunction.__set__('fs', require('./mockfs'));
    switch (SELECTED_FUNCTION) {
        case functions.countFiles:
            var dirToCheck = path.join(__dirname, '.');
            var sample = function (callback) {
                selectedFunction(dirToCheck, function (err, result) {
                    setImmediate(callback, err, result);
                });
            };
            break;

        case functions.fibonacci:
            var n = 5;
            var sample = function (callback) {
                selectedFunction(n, function (err, result) {
                    setImmediate(callback, err, result);
                });
            };
            break;

        case functions.largest:
            var dirToCheck = path.join(__dirname, '.');
            var options = { recurse: true, preview: true };
            var sample = function (callback) {
                selectedFunction(dirToCheck, options, function (err, result) {
                    setImmediate(callback, err, result);
                });
            };
            break;

    }
    return sample;
}
