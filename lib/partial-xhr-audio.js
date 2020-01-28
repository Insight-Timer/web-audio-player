var xhr = require('xhr')
var xhrProgress = require('xhr-progress')

var DEFAULT_DOWNLOAD_LENGTH = 5 * 1000000

// -- append 2 buffers together
function appendBuffer (buffer1, buffer2) {
  var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength)
  tmp.set(new Uint8Array(buffer1), 0)
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength)
  return tmp.buffer
}

/**
 * Usage:
 * var downloadManager = new PartialXhrAudio(audioContext, 'https://domain/file.mp3', successErrorCallback, progressCallback, decodingCallback)
 * downloadManager.start() or downloadManager.start(true)
 */
function PartialXhrAudio (audioContext, src, cb, progress, decoding) {
  var downloadedBuffer = new Uint8Array(0)
  var downloadedLength = 0
  var totalLength = 0
  var maxDownloadLength = DEFAULT_DOWNLOAD_LENGTH // approx 5mb per download

  // expose methods and variables
  return {
    setDownloadLength: function (length) {
      maxDownloadLength = length
      return this
    },
    start: start
  }

  // -- download chunk
  function start (recursive) {
    var rangeHeader = getRangeHeader()
    // if rangeHeader null, stop the download.
    if (!rangeHeader) return

    var opts = {
      uri: src,
      responseType: 'arraybuffer'
    }

    opts['headers'] = {
      Range: rangeHeader
    }

    var xhrObject = xhr(opts, function (err, resp, newBuffer) {
      if (!/^2/.test(resp.statusCode)) {
        err = new Error('status code ' + resp.statusCode + ' requesting ' + src)
      }
      if (err) return cb(err)

      // 'content-range' header is essential, so if its not available then throw an error.
      // we only need to get it once and store it.
      if (!resp.headers['content-range']) {
        return cb(new Error('`content-range` not found in response headers'))
      }

      if (!totalLength) {
        totalLength = parseInt(resp.headers['content-range'].split('/')[1], 10)
      }

      downloadedLength += newBuffer.byteLength
      downloadedBuffer = appendBuffer(downloadedBuffer, newBuffer)
      decode(recursive)
    })

    xhrProgress(xhrObject).on('data', function (amount, total) {
      progress(amount, total)
    })
  }

  // -- get Range header value for the next request
  function getRangeHeader () {
    var willDownloadedlength = downloadedLength + maxDownloadLength

    // If first download or willDownloadedlength still less than totalLength
    if (
      (downloadedLength === 0 && totalLength === 0) ||
      willDownloadedlength < totalLength
    ) {
      return 'bytes=' + downloadedLength + '-' + willDownloadedlength
    }

    // if we already download them all
    if (downloadedLength >= totalLength) return null

    // else, get the rest of the file
    return 'bytes=' + downloadedLength + '-'
  }

  // -- decode array buffer, and notify the caller by calling the callback function.
  function decode (recursive) {
    // allow lib user to preprocess the arrayBuffer before we decode them.
    var preDecodedBuff = decoding(downloadedBuffer)
    var buff = preDecodedBuff || downloadedBuffer

    audioContext.decodeAudioData(
      buff,
      function (decoded) {
        cb(null, decoded, downloadedLength, totalLength)

        // start the next download after a short break.
        if (recursive === true) {
          setTimeout(function () {
            start(recursive)
          }, 1000)
        }
      },
      function () {
        var err = new Error('Error decoding audio data')
        err.type = 'DECODE_AUDIO_DATA'
        cb(err)
      }
    )
  }
}

module.exports = PartialXhrAudio
module.exports.DEFAULT_DOWNLOAD_LENGTH = DEFAULT_DOWNLOAD_LENGTH
