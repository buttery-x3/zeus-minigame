module.exports = {
  apps: [
    {
      name: "zeus-minigame",
      script: "server/static-server.mjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "4000",
        HOSTS: "127.0.0.1,::1",
      },
    },
  ],
};
