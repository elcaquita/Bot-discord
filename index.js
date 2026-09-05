const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`¡Bot encendido como ${client.user.tag}!`);
});

// Pega tu token de Discord aquí directamente entre las comillas
client.login("MTU0NTQzNzc2ODAwMjMxMDI2Ng.GzKHwB.gwUVgYvNhihZZZ7zkXZGdq_TKofcuJOUaBXylA");
