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

// Aquí dejamos la variable para que Railway lea el token de forma segura
client.login(process.env.DISCORD_TOKEN);
