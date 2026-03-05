const noop = () => {};
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

export const log = isDev ? console.log.bind(console) : noop;
export const warn = isDev ? console.warn.bind(console) : noop;
export const error = isDev ? console.error.bind(console) : noop;
