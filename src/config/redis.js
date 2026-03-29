const client = {
  get: async () => null,
  setEx: async () => null,
  del: async () => null,
  connect: async () => {},
  on: () => {},
};

const connect = async () => {
  console.log('Redis disabled - using mock');
};

module.exports = { client, connect };