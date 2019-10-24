var canPlaySrc = require('./can-play-src')
var createAudioContext = require('./audio-context')
var PartialXhrAudio = require('./partial-xhr-audio')
var EventEmitter = require('events').EventEmitter
var rightNow = require('right-now')
var resume = require('./resume-context')

module.exports = createPartialBufferSource

function createPartialBufferSource(src, opt) {
    opt = opt || {}
    var emitter = new EventEmitter()
    var audioContext = opt.context || createAudioContext()

    // a pass-through node so user just needs to
    // connect() once
    var bufferNode, duration
    var playBuffer
    var node = audioContext.createGain()
    var audioStartTime = null
    var audioPauseTime = null
    var audioCurrentTime = 0
    var playing = false
    var loop = opt.loop
    var readyState = 0
    var timer = null
    var source = null
    var downloadManager = null
    var nextDownloadStarted = false

    emitter.play = function () {
        if (playing) return
        playing = true

        if (opt.autoResume !== false) resume(emitter.context)
        disposeBuffer()
        bufferNode = audioContext.createBufferSource()
        bufferNode.connect(emitter.node)
        bufferNode.onended = ended
        if (playBuffer) {
            // Might be null undefined if we are still loading
            bufferNode.buffer = playBuffer
        }
        if (loop) {
            bufferNode.loop = true
            if (typeof opt.loopStart === 'number') bufferNode.loopStart = opt.loopStart
            if (typeof opt.loopEnd === 'number') bufferNode.loopEnd = opt.loopEnd
        }

        if (duration && audioCurrentTime > duration) {
            // for when it loops...
            audioCurrentTime = audioCurrentTime % duration
        }
        var nextTime = audioCurrentTime

        bufferNode.start(0, nextTime)
        audioStartTime = rightNow()
        startTimer()

        // start next download if it never started.
        if (downloadManager && !nextDownloadStarted) {
            downloadManager.start(true) // start recursive download.
            nextDownloadStarted = true
        }
    }

    emitter.pause = function () {
        if (!playing) return
        playing = false
        // Don't let the "end" event
        // get triggered on manual pause.
        bufferNode.onended = null
        bufferNode.stop(0)
        audioPauseTime = rightNow()
        audioCurrentTime += (audioPauseTime - audioStartTime) / 1000
        emitter.emit('timeupdate', audioCurrentTime)
        stopTimer()
    }

    emitter.stop = function () {
        emitter.pause()
        ended()
    }

    emitter.dispose = function () {
        disposeBuffer()
        playBuffer = null
    }

    emitter.node = node
    emitter.context = audioContext

    Object.defineProperties(emitter, {
        duration: {
            enumerable: true,
            configurable: true,
            get: function () {
                return duration
            }
        },
        readyState: {
            enumerable: true,
            configurable: true,
            get: function () {
                return readyState
            }
        },
        currentTime: {
            enumerable: true,
            configurable: true,
            get: function () {
                return audioCurrentTime
            },
            set: function (t) {
                audioCurrentTime = t
            }
        },
        playing: {
            enumerable: true,
            configurable: true,
            get: function () {
                return playing
            }
        },
        buffer: {
            enumerable: true,
            configurable: true,
            get: function () {
                return playBuffer
            }
        },
        volume: {
            enumerable: true,
            configurable: true,
            get: function () {
                return node.gain.value
            },
            set: function (n) {
                node.gain.value = n
            }
        }
    })

    // set initial volume
    if (typeof opt.volume === 'number') {
        emitter.volume = opt.volume
    }

    // filter down to a list of playable sources
    var sources = Array.isArray(src) ? src : [src]
    sources = sources.filter(Boolean)
    var playable = sources.some(canPlaySrc)
    if (playable) {
        source = sources.filter(canPlaySrc)[0]
        // Support the same source types as in
        // MediaElement mode...
        if (typeof source.getAttribute === 'function') {
            source = source.getAttribute('src')
        } else if (typeof source.src === 'string') {
            source = source.src
        }
        // We have at least one playable source.
        // For now just play the first,
        // ideally this module could attempt each one.
        startLoad(source)
    } else {
        // no sources can be played...
        process.nextTick(function () {
            emitter.emit('error', canPlaySrc.createError(sources))
        })
    }

    return emitter

    //-- load the audio
    function startLoad(src) {

        downloadManager = new PartialXhrAudio(audioContext, src, function audioDecoded(err, decoded, chunkBytes, totalBytes) {
            if (err) return emitter.emit('error', err)

            // set total duration once
            if (!duration) {
                if (chunkBytes >= totalBytes) {
                    duration = decoded.duration
                } else {
                    duration = (decoded.duration * totalBytes) / chunkBytes
                }
            }

            // create playBuffer once
            if (!playBuffer) {
                playBuffer = audioContext.createBuffer(decoded.numberOfChannels, duration * decoded.sampleRate, decoded.sampleRate)
            }

            // set content 
            for (var channel = 0; channel < decoded.numberOfChannels; channel++) {
                var playBufferChannelData = playBuffer.getChannelData(channel)
                var decodedChannel = decoded.getChannelData(channel)
                for (var i = 0; i < decoded.length; i++) {
                    playBufferChannelData[i] = decodedChannel[i]
                }
            }

            readyState = 4 // https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/readyState
            emitter.emit('loadedDuration', decoded.duration)
            emitter.emit('load')

        }, function audioProgress(amount, total) {
            emitter.emit('progress', amount, total)

        }, function audioDecoding(arrayBuf) {
            emitter.emit('decoding')
            // if preDecode is specified, it MUST return arrayBuf too.
            if (opt.preDecode && typeof opt.preDecode === 'function') {
                return opt.preDecode(arrayBuf)
            }
        })
        // start the first download
        downloadManager.start()
    }

    function ended() {
        emitter.emit('end')
        playing = false
        stopTimer()
        audioCurrentTime = 0
        emitter.emit('timeupdate', audioCurrentTime)
    }

    function disposeBuffer() {
        if (bufferNode) bufferNode.disconnect()
    }

    function startTimer() {
        var tick = function () {
            timer = window.requestAnimationFrame(tick)
            var curTime = audioCurrentTime + ((rightNow() - audioStartTime) / 1000)
            if (duration && curTime > duration) {
                // for when it loops...
                curTime = curTime % duration
            }
            emitter.emit('timeupdate', curTime)
        }
        tick()
    }

    function stopTimer() {
        if (timer) {
            window.cancelAnimationFrame(timer)
        }
    }
}