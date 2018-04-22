module.exports = {
  "env": {
    "es6": true,
    "node": true,
  },
  "plugins": [
    "flowtype",
  ],
  "extends": [
    "eslint:recommended",
    "plugin:flowtype/recommended",
  ],
  "rules": {
    "indent": [
      "error",
      2
    ],
    "linebreak-style": [
      "error",
      "unix"
    ],
    "quotes": [
      "error",
      "single"
    ],
    "semi": [
      "error",
      "always"
    ]
  }
};
