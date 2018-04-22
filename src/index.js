// @flow
const stream = require('stream');

type ParseStreamOptions = {
  parseDataGram: (Buffer) => any,
  getDataGramLength: (Buffer) => number,
  // Insanely, the node default typedef exports this as a global
  // I bet that leads to some nasty bugs
  ...duplexStreamOptions
};

class ParseStream extends stream.Transform {
  constructor(options: ParseStreamOptions) {
    super(options);
    if (typeof options.parseDataGram !== 'function') {
      throw new Error('"parseDataGram: (Buffer) => any" function required!');
    }
    if (typeof options.getDataGramLength !== 'function') {
      throw new Error('"getDataGramLength: (buffer) => number" function required!');
    }
    this._fns = {
      parseDataGram: options.parseDataGram,
      getDataGramLength: options.getDataGramLength,
    };
    this._continuation = {
      chunks: [],
      desiredLen: 0,
      recvLen: 0
    };
  }
  _fns: *;
  _continuation: *;
  _transform(chunk, encoding, callback) {
    // It's possible the data coming through here is split into pieces; we need to buffer
    // until we know we have the whole message.
    const continuation = this._continuation;
    if (continuation.chunks.length > 0) {
      continuation.chunks.push(chunk);
      continuation.recvLen += chunk.length;

      if (continuation.recvLen < continuation.desiredLen) {
        // still more to go, continue, but don't queue up too many timers
        if (continuation.chunks.length % 20 === 0) return setImmediate(callback);
        return callback();
      }
      // Done coalescing, reset.
      chunk = Buffer.concat(continuation.chunks);
      continuation.chunks = [];
    }

    // Keep emitting while there's data to emit
    let thisLen = this._fns.getDataGramLength(chunk);

    while (thisLen <= chunk.length) {
      const thisSlice = chunk.slice(0, thisLen);
      this.emit('chunkLen', thisLen);
      // Design question: Do we even want to parse here or just push the raw buffer,
      // and let the developer pipe into another stream to actually parse it?
      this.push(this._fns.parseDataGram(thisSlice));
      chunk = chunk.slice(thisLen);
      thisLen = this._fns.getDataGramLength(chunk);
    }

    //
    // Looks like there's more to come in the next payload?
    //
    if (chunk.length) {
      this._continuation.chunks.push(chunk);
      this._continuation.desiredLen = thisLen;
      this._continuation.recvLen = chunk.length;
    }

    // Signal we're ready for more, but don't allow starving the event loop
    // In pathological cases, if this stream is fully saturated and we don't use setImmediate,
    // downstream will never tick which can cause excessive buffering and even segfaults.
    return setImmediate(callback);
  }
}

module.exports = ParseStream;
