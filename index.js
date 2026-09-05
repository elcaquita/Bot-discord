const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration // Necesario para acciones anti-spam/raids si decides banear/silenciar
  ]
});

// Almacenamiento en memoria para configuraciones y control de spam (en un servidor grande se usaría base de datos, para empezar esto va perfecto)
const antiRaidSettings = new Map(); // guildId -> { enabled: boolean, logChannelId: string }
const spamTracker = new Map();     // userId -> { count: number, lastMessageTimestamp: number }

client.once('clientReady', async () => {
  console.log(`¡Bot encendido como ${client.user.tag}!`);

  // Definir los comandos de barra (Slash Commands)
  const commands = [
    new SlashCommandBuilder()
      .setName('antiraid')
      .setDescription('Activa o desactiva el sistema de protección contra raids y spam')
      .addBooleanOption(option =>
        option.name('estado')
          .setDescription('Elige true para encender o false para apagar')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('logsraid')
      .setDescription('Configura el canal actual para recibir los reportes y alertas de seguridad')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log('Registrando comandos de barra (/)...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('¡Comandos de barra registrados con éxito!');
  } catch (error) {
    console.error('Error al registrar comandos:', error);
  }
});

// Manejador de comandos de barra (/antiraid y /logsraid)
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, channel } = interaction;
  if (!guild) return;

  // Obtener o inicializar configuración de la guild
  if (!antiRaidSettings.has(guild.id)) {
    antiRaidSettings.set(guild.id, { enabled: false, logChannelId: null });
  }
  const settings = antiRaidSettings.get(guild.id);

  if (commandName === 'antiraid') {
    const estado = interaction.options.getBoolean('estado');
    settings.enabled = estado;

    await interaction.reply({
      content: `🛡️ El sistema Anti-Raid ha sido **${estado ? 'ACTIVADO 🟢' : 'DESACTIVADO 🔴'}** para este servidor.`,
      ephemeral: true
    });
  }

  if (commandName === 'logsraid') {
    settings.logChannelId = channel.id;

    await interaction.reply({
      content: `📝 ¡Canal configurado con éxito! Ahora las alertas de seguridad y raids llegarán aquí: ${channel}`,
      ephemeral: true
    });
  }
});

// Función auxiliar para enviar alertas al canal de logs configurado
async function sendRaidLog(guild, title, description, color = 0xFF0000) {
  const settings = antiRaidSettings.get(guild.id);
  if (!settings || !settings.enabled || !settings.logChannelId) return;

  const logChannel = guild.channels.cache.get(settings.logChannelId);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle(`🚨 ALERTA ANTI-RAID: ${title}`)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('No se pudo enviar el log de raid:', err);
  }
}

// 1. Detección de enlaces (Links) y Spam masivo de mensajes
client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  const settings = antiRaidSettings.get(message.guild.id);
  if (!settings || !settings.enabled) return; // Si el antiraid está apagado, no hace nada

  const userId = message.author.id;
  const now = Date.now();

  // --- Detector de Links / Invitaciones de Discord ---
  const linkRegex = /(https?:\/\/|discord\.gg\/|discord\.com\/invite\/)/i;
  if (linkRegex.test(message.content)) {
    try {
      await message.delete();
      await sendRaidLog(
        message.guild, 
        'Enlace Bloqueado', 
        `Se eliminó un mensaje con enlace sospechoso enviado por ${message.author} (${message.author.tag}) en ${message.channel}.\n\n**Contenido:** ${message.content}`
      );
      return;
    } catch (e) {
      console.log('No se pudo borrar el mensaje con link (falta de permisos)');
    }
  }

  // --- Detector de Spam Masivo (Muchos mensajes en pocos segundos) ---
  if (!spamTracker.has(userId)) {
    spamTracker.set(userId, { count: 1, lastMessageTimestamp: now });
  } else {
    const userData = spamTracker.get(userId);
    const timeDiff = now - userData.lastMessageTimestamp;

    if (timeDiff < 4000) { // Si manda mensaje en menos de 4 segundos
      userData.count++;
      userData.lastMessageTimestamp = now;

      if (userData.count >= 5) { // Si pasa de 5 mensajes seguidos muy rápido
        try {
          // Borrar el mensaje actual de spam
          await message.delete();
          
          await sendRaidLog(
            message.guild, 
            'Spam Detectado', 
            `El usuario ${message.author} (${message.author.tag}) fue detectado haciendo spam masivo en ${message.channel}.`
          );
          
          // Opcional: Podrías mutearlo o advertirle aquí
        } catch (e) {
          console.log('Error manejando spam');
        }
      }
    } else {
      userData.count = 1;
      userData.lastMessageTimestamp = now;
    }
  }
});

// 2. Detección de Creación Masiva de Canales (posible Raid de canales)
const channelCreationTracker = new Map(); // guildId -> { count: number, timestamp: number }

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
    if (now - data.timestamp < 10000) { // Si crean canales en menos de 10 segundos
      data.count++;
      if (data.count >= 3) { // Si crean 3 o más canales de golpe
        await sendRaidLog(
          channel.guild, 
          '¡Posible Raid Masivo de Canales!', 
          `Se han creado múltiples canales (${data.count}) en un periodo muy corto de tiempo. ¡Atención administradores!`
        );
      }
    } else {
      data.count = 1;
      data.timestamp = now;
    }
  }
});

// Iniciar sesión con la variable de entorno segura de Railway
client.login(process.env.DISCORD_TOKEN);
