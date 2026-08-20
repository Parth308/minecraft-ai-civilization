function formatMessage(moduleName, message) {
  const timestamp = new Date().toISOString().substring(11, 19);
  return `[${timestamp}] [${moduleName}] ${message}`;
}

const logger = {
  info: (moduleName, message, ...args) => {
    console.log(formatMessage(moduleName, message), ...args);
  },
  warn: (moduleName, message, ...args) => {
    console.warn(formatMessage(moduleName, message), ...args);
  },
  error: (moduleName, message, ...args) => {
    console.error(formatMessage(moduleName, message), ...args);
  },
  debug: (moduleName, message, ...args) => {
    if (process.env.DEBUG) {
      console.log(formatMessage(`DEBUG:${moduleName}`, message), ...args);
    }
  }
};

module.exports = logger;
