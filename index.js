const { Client, GatewayIntentBits, REST, Routes, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ]
});

const antiRaidSettings = new Map();
const spamTracker = new Map();
const channelCreationTracker = new Map();
const channelDeletionTracker = new Map();

client.once('clientReady', async () => {
  console.log(`¡Bot encendido como ${client.user.tag}!`);

  const commands = [
    {
      name: 'antiraid',
      description: 'Activa o desactiva el sistema de protección contra raids y spam',
      default_member_permissions: String(PermissionFlagsBits.Administrator),
      options: [
        {
          name: 'estado',
          description: 'Elige true para encender o false para apagar',
          type: 5,
          required: true
        }
      ]
    },
    {
      name: 'logsraid',
      description: 'Configura el canal actual para recibir los reportes y alertas de seguridad',
      default_member_permissions: String(PermissionFlagsBits.Administrator)
    }
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('¡Comandos de barra registrados con éxito!');
  } catch (error) {
    console.error('Error al registrar comandos:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, channel } = interaction;
  if (!guild) return;

  if (!antiRaidSettings.has(guild.id)) {
    antiRaidSettings.set(guild.id, { enabled: false, logChannelId: null });
  }
  const settings = antiRaidSettings.get(guild.id);

  if (commandName === 'antiraid') {
    await interaction.deferReply({ ephemeral: true });
    const estado = interaction.options.getBoolean('estado');
    settings.enabled = estado;

    await interaction.editReply({
      content: `🛡️ El sistema Anti-Raid ha sido **${estado ? 'ACTIVADO 🟢' : 'DESACTIVADO 🔴'}** para este servidor.`
    });
  }

  if (commandName === 'logsraid') {
    await interaction.deferReply({ ephemeral: true });
    settings.logChannelId = channel.id;

    await interaction.editReply({
      content: `📝 ¡Canal configurado con éxito! Ahora las alertas de seguridad y raids llegarán aquí: ${channel}`
    });
  }
});

async function sendRaidLog(guild, title, description, color = 0xFF0000, fields = []) {
  const settings = antiRaidSettings.get(guild.id);
  if (!settings || !settings.enabled || !settings.logChannelId) return;

  const logChannel = guild.channels.cache.get(settings.logChannelId);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle(`🚨 ALERTA ANTI-RAID: ${title}`)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();

  if (fields.length > 0) {
    embed.addFields(fields);
  }

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('No se pudo enviar el log de raid:', err);
  }
}

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  const settings = antiRaidSettings.get(message.guild.id);
  if (!settings || !settings.enabled) return;

  const userId = message.author.id;
  const now = Date.now();

  const linkRegex = /(https?:\/\/|discord\.gg|discord\.com\/invite)/i;
  if (linkRegex.test(message.content)) {
    try {
      const contenidoMensaje = message.content;
      await message.delete();
      await sendRaidLog(
        message.guild, 
        'Enlace Bloqueado / Eliminado', 
        `Se eliminó un mensaje con enlace sospechoso enviado por ${message.author} (${message.author.tag}) en ${message.channel}.`,
        0xFF0000,
        [{ name: 'Contenido del mensaje:', value: contenidoMensaje || 'Sin texto' }]
      );
      return;
    } catch (e) {
      console.log('No se pudo borrar el mensaje con link');
    }
  }

  if (!spamTracker.has(userId)) {
    spamTracker.set(userId, { count: 1, lastMessageTimestamp: now, warnings: 1 });
  } else {
    const userData = spamTracker.get(userId);
    const timeDiff = now - userData.lastMessageTimestamp;

    if (timeDiff < 4000) {
      userData.count++;
      userData.lastMessageTimestamp = now;

      if (userData.count >= 4) {
        userData.count = 0;
        userData.warnings = (userData.warnings || 1) + 1;
        const currentWarning = userData.warnings > 3 ? 3 : userData.warnings;

        try {
          await message.delete();
        } catch (err) {}

        if (currentWarning < 3) {
          try {
            await message.channel.send(`No spamees mas ${currentWarning}/3 a la tercera advertencia aislamiento de una hora, esta se te quitara en 10 minutos, ${message.author}`);
          } catch (err) {}

          await sendRaidLog(
            message.guild,
            'Spam Detectado (Advertencia)',
            `El usuario ${message.author} recibió advertencia ${currentWarning}/3 por spam en ${message.channel}.`
          );
        } else {
          try {
            const member = await message.guild.members.fetch(userId);
            await member.timeout(60 * 60 * 1000, 'Spam masivo - Tercera advertencia');
            await message.channel.send(`⚠️ ${message.author} ha alcanzado 3/3 advertencias y ha sido aislado por 1 hora.`);
          } catch (err) {
            console.log('No se pudo aplicar el timeout');
          }

          await sendRaidLog(
            message.guild,
            'Usuario Aislado por Spam',
            `El usuario ${message.author} (${message.author.tag}) fue aislado (timeout) por 1 hora tras acumular 3 advertencias de spam.`
          );
          
          userData.warnings = 0;
        }
      }
    } else {
      userData.count = 1;
      userData.lastMessageTimestamp = now;
    }
  }
});

// Detector de borrado masivo de canales
client.on('channelDelete', async channel => {
  if (!channel.guild) return;

  const settings = antiRaidSettings.get(channel.guild.id);
  if (!settings || !settings.enabled) return;

  const guildId = channel.guild.id;
  const now = Date.now();

  if (!channelDeletionTracker.has(guildId)) {
    channelDeletionTracker.set(guildId, { count: 1, timestamp: now });
  } else {
    const data = channelDeletionTracker.get(guildId);
    if (now - data.timestamp < 10000) {
      data.count++;
      if (data.count >= 2) {
        await sendRaidLog(
          channel.guild,
          '¡ALERTA CRÍTICA: Borrado Masivo de Canales!',
          `Se detectó que están borrando múltiples canales en cuestión de segundos (${data.count} canales eliminados). ¡Posible Nuke/Raid en progreso!`
        );
      }
    } else {
      data.count = 1;
      data.timestamp = now;
    }
  }
});

// Detector de creación masiva de canales y autodelete
client.on('channelCreate', async channel => {
  if (!channel.guild) return;

  const settings = antiRaidSettings.get(channel.guild.id);
  if (!settings || !settings.enabled) return;

  const guildId = channel.guild.id;
  const now = Date.now();

  if (!channelCreationTracker.has(guildId)) {
    channelCreationTracker.set(guildId, { count: 1, timestamp: now });
  } else {
    const data = channelCreationTracker.get(guildId);
    if (now - data.timestamp < 10000) {
      data.count++;
      if (data.count >= 2) {
        try {
          await channel.delete('Protección Anti-Raid: Creación masiva de canales bloqueada');
        } catch (e) {
          console.log('No se pudo borrar el canal creado en raid');
        }

        await sendRaidLog(
          channel.guild, 
          '¡Canal Eliminado por Raid Masivo!', 
          `Se detectó un intento de raid creando canales masivamente. El canal "${channel.name}" ha sido eliminado automáticamente.`
        );
      }
    } else {
      data.count = 1;
      data.timestamp = now;
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
