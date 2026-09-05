const { Client, GatewayIntentBits, REST, Routes, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AuditLogEvent } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMembers
  ]
});

const antiRaidSettings = new Map();
const spamTracker = new Map();
const channelCreationTracker = new Map();
const channelDeletionTracker = new Map();

// Listas de seguridad
const whiteList = new Map(); // guildId -> Set(userId)
const blackList = new Map(); // guildId -> Set(userId)
const verifiedRoleConfig = new Map(); // guildId -> roleId

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
    },
    {
      name: 'whitelist',
      description: 'Agrega o quita a un usuario de la Whitelist',
      default_member_permissions: String(PermissionFlagsBits.Administrator),
      options: [
        {
          name: 'accion',
          description: 'Añadir o remover',
          type: 3,
          required: true,
          choices: [
            { name: 'Añadir', value: 'add' },
            { name: 'Remover', value: 'remove' }
          ]
        },
        {
          name: 'usuario',
          description: 'Usuario objetivo',
          type: 6,
          required: true
        }
      ]
    },
    {
      name: 'blacklist',
      description: 'Mete a un usuario en la BlackList (bloqueo total)',
      default_member_permissions: String(PermissionFlagsBits.Administrator),
      options: [
        {
          name: 'accion',
          description: 'Añadir o remover',
          type: 3,
          required: true,
          choices: [
            { name: 'Añadir', value: 'add' },
            { name: 'Remover', value: 'remove' }
          ]
        },
        {
          name: 'usuario',
          description: 'Usuario objetivo',
          type: 6,
          required: true
        }
      ]
    },
    {
      name: 'verfiquechannel',
      description: 'Crea el panel interactivo de verificación en el canal actual',
      default_member_permissions: String(PermissionFlagsBits.Administrator),
      options: [
        {
          name: 'rol',
          description: 'Rol que se entregará al verificarse',
          type: 8,
          required: true
        }
      ]
    }
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    const GUILD_ID = "1545825158009327710"; 

    // Limpia los comandos globales anteriores para evitar duplicados en Discord
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });

    // Registra los comandos limpios en tu servidor de forma instantánea
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands },
    );
    console.log('¡Comandos sincronizados y sin duplicados!');
  } catch (error) {
    console.error('Error al registrar comandos:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const { commandName, guild, channel, options } = interaction;
    if (!guild) return;

    if (!antiRaidSettings.has(guild.id)) {
      antiRaidSettings.set(guild.id, { enabled: false, logChannelId: null });
    }
    const settings = antiRaidSettings.get(guild.id);

    if (!whiteList.has(guild.id)) whiteList.set(guild.id, new Set());
    if (!blackList.has(guild.id)) blackList.set(guild.id, new Set());

    if (commandName === 'antiraid') {
      await interaction.deferReply({ ephemeral: true });
      const estado = options.getBoolean('estado');
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

    if (commandName === 'whitelist') {
      await interaction.deferReply({ ephemeral: true });
      const action = options.getString('accion');
      const targetUser = options.getUser('usuario');
      const list = whiteList.get(guild.id);

      if (action === 'add') {
        list.add(targetUser.id);
        await interaction.editReply({ content: `✅ El usuario ${targetUser.tag} fue agregado a la **Whitelist**.` });
      } else {
        list.delete(targetUser.id);
        await interaction.editReply({ content: `❌ El usuario ${targetUser.tag} fue removido de la **Whitelist**.` });
      }
    }

    if (commandName === 'blacklist') {
      await interaction.deferReply({ ephemeral: true });
      const action = options.getString('accion');
      const targetUser = options.getUser('usuario');
      const list = blackList.get(guild.id);

      if (action === 'add') {
        list.add(targetUser.id);
        try {
          const member = await guild.members.fetch(targetUser.id);
          await member.timeout(28 * 24 * 60 * 60 * 1000, 'Añadido a Blacklist');
        } catch (e) {}
        await interaction.editReply({ content: `⛔ El usuario ${targetUser.tag} fue agregado a la **Blacklist** y aislado.` });
      } else {
        list.delete(targetUser.id);
        await interaction.editReply({ content: `✅ El usuario ${targetUser.tag} fue removido de la **Blacklist**.` });
      }
    }

    if (commandName === 'verfiquechannel') {
      await interaction.deferReply({ ephemeral: true });
      const role = options.getRole('rol');
      verifiedRoleConfig.set(guild.id, role.id);

      const embed = new EmbedBuilder()
        .setTitle('🔒 Verificación del Servidor')
        .setDescription('Haz clic en el botón de abajo para verificar tu cuenta y desbloquear el acceso al servidor.')
        .setColor(0x00FF00);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('verify_button')
          .setLabel('Verificarse')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅')
      );

      await channel.send({ embeds: [embed], components: [row] });
      await interaction.editReply({ content: `✅ ¡Panel de verificación creado con éxito en este canal con el rol ${role.name}!` });
    }
  } 
  else if (interaction.isButton()) {
    if (interaction.customId === 'verify_button') {
      const guild = interaction.guild;
      const roleId = verifiedRoleConfig.get(guild.id);
      if (!roleId) {
        return interaction.reply({ content: '❌ Este servidor no tiene configurado un rol de verificación aún.', ephemeral: true });
      }

      try {
        const role = guild.roles.cache.get(roleId);
        await interaction.member.roles.add(role);
        await interaction.reply({ content: '🎉 ¡Te has verificado correctamente!', ephemeral: true });
      } catch (e) {
        await interaction.reply({ content: '❌ Ocurrió un error al asignarte el rol. Contacta a un administrador.', ephemeral: true });
      }
    }
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

// Filtro BlackList / Spam / Links
client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  const guildId = message.guild.id;
  const userId = message.author.id;

  if (whiteList.has(guildId) && whiteList.get(guildId).has(userId)) return;

  // Revisar BlackList
  if (blackList.has(guildId) && blackList.get(guildId).has(userId)) {
    try { await message.delete(); } catch (e) {}
    return;
  }

  const settings = antiRaidSettings.get(guildId);
  if (!settings || !settings.enabled) return;

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
    } catch (e) {}
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

        try { await message.delete(); } catch (err) {}

        if (currentWarning < 3) {
          try {
            await message.channel.send(`No spamees mas ${currentWarning}/3 a la tercera advertencia aislamiento de una hora, esta se te quitara en 10 minutos, ${message.author}`);
          } catch (err) {}
        } else {
          try {
            const member = await message.guild.members.fetch(userId);
            
            // Guarda los roles actuales (excluyendo el rol @everyone)
            const rolesToRestore = member.roles.cache
              .filter(role => role.id !== message.guild.id)
              .map(role => role.id);

            // Quita los roles y aplica timeout de 10 minutos
            await member.roles.remove(rolesToRestore, 'Spam masivo - Quita de roles temporal');
            await member.timeout(10 * 60 * 1000, 'Spam masivo - Aislamiento de 10 minutos');
            
            await message.channel.send(`⚠️ Aislamiento de 10 minutos dado, ${message.author}`);

            // Programa la devolución de los roles después de 10 minutos exactos
            setTimeout(async () => {
              try {
                const fetchedMember = await message.guild.members.fetch(userId);
                if (fetchedMember) {
                  await fetchedMember.roles.add(rolesToRestore, 'Devolución de roles tras finalizar aislamiento');
                }
              } catch (err) {
                console.log('No se pudieron devolver los roles al usuario:', err);
              }
            }, 10 * 60 * 1000);

          } catch (err) {
            console.error(err);
          }

          await sendRaidLog(
            message.guild,
            'Usuario Aislado por Spam',
            `El usuario ${message.author} (${message.author.tag}) fue aislado por 10 minutos y se le retiraron los roles temporalmente.`
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
      if (data.count >= 3) {
        await sendRaidLog(
          channel.guild,
          '¡ALERTA CRÍTICA: Borrado Masivo de Canales!',
          `Se detectó la eliminación masiva de canales en segundos (${data.count} canales borrados). ¡Posible Nuke/Raid detectado!`
        );
      }
    } else {
      data.count = 1;
      data.timestamp = now;
    }
  }
});

// Detector de creación masiva de canales
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
      if (data.count >= 3) {
        try {
          await channel.delete('Protección Anti-Raid: Creación masiva bloqueada');
        } catch (e) {}

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

// Detectar bots añadidos para banear al bot y a quien lo invitó
client.on('guildMemberAdd', async member => {
  if (!member.user.bot) return;
  const guild = member.guild;

  const settings = antiRaidSettings.get(guild.id);
  if (!settings || !settings.enabled) return;

  try {
    const fetchedLogs = await guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.BotAdd,
    });
    const botAddLog = fetchedLogs.entries.first();

    if (botAddLog) {
      const { executor, target } = botAddLog;
      if (target.id === member.id) {
        await guild.members.ban(member.id, { reason: 'Bot añadido durante un posible raid' });
        
        if (executor && !(whiteList.has(guild.id) && whiteList.get(guild.id).has(executor.id))) {
          await guild.members.ban(executor.id, { reason: `Invitó un bot malicioso/no autorizado: ${member.user.tag}` });
          
          await sendRaidLog(
            guild,
            'Bot y Responsable Baneados',
            `El bot ${member} fue detectado y baneado junto con el usuario que lo invitó: ${executor} (${executor.tag}).`,
            0xFF0000
          );
        }
      }
    }
  } catch (e) {
    console.log('No se pudo verificar el audit log para el bot añadido:', e);
  }
});

client.login(process.env.DISCORD_TOKEN);
