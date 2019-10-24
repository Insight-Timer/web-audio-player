var buffer = require('./lib/buffer-source')
var partialBuffer = require('./lib/partial-buffer-source')
var media = require('./lib/media-source')

module.exports = webAudioPlayer

function webAudioPlayer(src, opt) {
  if (!src) throw new TypeError('must specify a src parameter')
  opt = opt || {}
  if (opt.buffer) return buffer(src, opt)
  if (opt.partialbuffer) return partialBuffer(src, opt)
  else return media(src, opt)
}