/* eslint-disable @typescript-eslint/no-require-imports */

const path = require('path');

const base = require('./jest.config');

const dir = (name) => path.dirname(require.resolve(`${name}/package.json`));

module.exports = {
  ...base,
  moduleNameMapper: {
    '^react$': dir('react18'),
    '^react/(.*)$': `${dir('react18')}/$1`,
    '^react-dom$': dir('react-dom18'),
    '^react-dom/(.*)$': `${dir('react-dom18')}/$1`,
  },
};
