
require("dotenv").config();

const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const session = require("express-session");
const { MongoClient, ObjectId } = require("mongodb");
const passport = require("passport");
const compression = require("compression");
const DiscordStrategy = require("passport-discord").Strategy;

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    UserSelectMenuBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require("discord.js");

const app = express();
const PORT = process.env.PORT || 3000;

const mongo = new MongoClient(process.env.MONGO_URI);

let pointsCollection;
let termineCollection;
let examsCollection;
let docsCollection;
let logsCollection;

const discordMemberCache = new Map();
const DISCORD_CACHE_TIME = 1000 * 60 * 10;

let pointsListCache = null;
let pointsListCacheTime = 0;
const POINTS_LIST_CACHE_TIME = 1000 * 30;

const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const PRAKTI_SANI_ROLE_ID = process.env.PRAKTI_SANI_ROLE_ID;
const ROLE_TESTPHASE = process.env.PRAKTI_SANI_ROLE_ID;
const ROLE_FESTES_MITGLIED = process.env.ROLE_FESTES_MITGLIED;
const ROLE_SENIOR = process.env.ROLE_SENIOR;
const ROLE_UNTERE_LEITUNG = process.env.ROLE_UNTERE_LEITUNG;
const ROLE_STV_LEITUNG = process.env.ROLE_STV_LEITUNG;
const ROLE_LEITUNG = process.env.ROLE_LEITUNG;

const botClient = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

const spontaneSelections = new Map();
const spontaneRequests = new Map();
let spontaneRequestCounter = 1;


app.set("view engine", "ejs");

app.use(expressLayouts);
app.set("layout", "layout");

app.use(compression());

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static("public", {
    maxAge: "7d",
    etag: true
}));

app.use(session({
    secret: process.env.SESSION_SECRET || "lsmd-dashboard-secret",
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ["identify"]
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const response = await fetch(
            `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${profile.id}`,
            {
                headers: {
                    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
                }
            }
        );

        if (!response.ok) {
            return done(null, false);
        }

        const member = await response.json();
        const roles = member.roles || [];

        const isAdmin = roles.includes(ADMIN_ROLE_ID);
        const isPraktiSani = roles.includes(PRAKTI_SANI_ROLE_ID);
        const rank = getRankFromRoles(roles);


        if (!isAdmin && !isPraktiSani) {
            return done(null, false);
        }

const displayName =
    member.nick ||
    member.user?.global_name ||
    member.user?.username ||
    profile.username;

const avatarUrl = member.user?.avatar
    ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
    : null;

return done(null, {
    id: profile.id,
    username: displayName,
    avatar: avatarUrl,
    roles,
    isAdmin,
    role: isAdmin ? "Admin" : "Prakti-Sani",
    rank
});

    } catch (error) {
        return done(error, null);
    }
}));

function requireLogin(req, res, next) {
    if (!req.session.loggedIn) {
        return res.redirect("/login");
    }

    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.isAdmin) {
        return res.status(403).send("Kein Zugriff auf diesen Bereich.");
    }

    next();
}

function viewData(req, extra = {}) {
    return {
        user: req.session.user || null,
        isAdmin: req.session.isAdmin || false,
        active: "",
        ...extra
    };
}

function getRankFromRoles(roles = []) {
    if (roles.includes(ROLE_LEITUNG)) {
        return "Leitung";
    }

    if (roles.includes(ROLE_STV_LEITUNG)) {
        return "Stv Leitung";
    }

    if (roles.includes(ROLE_UNTERE_LEITUNG)) {
        return "Untere Leitung";
    }

    if (roles.includes(ROLE_SENIOR)) {
        return "Senior Prakti-Sani";
    }

    if (roles.includes(ROLE_FESTES_MITGLIED)) {
        return "Prakti-Sani Festes Mitglied";
    }

    if (roles.includes(ROLE_TESTPHASE)) {
        return "Prakti-Sani Testphase";
    }

    return "Kein Rang";
}

async function getDiscordMemberInfo(userId) {
    try {
        if (!userId) {
            return null;
        }

        const cached = discordMemberCache.get(userId);

        if (cached && Date.now() - cached.time < DISCORD_CACHE_TIME) {
            return cached.data;
        }

        const response = await fetch(
            `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}`,
            {
                headers: {
                    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
                }
            }
        );

        if (!response.ok) {
            return null;
        }

        const member = await response.json();

        const displayName =
            member.nick ||
            member.user?.global_name ||
            member.user?.username ||
            userId;

        const avatarUrl = member.user?.avatar
            ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
            : null;

        const roles = member.roles || [];
        const rank = getRankFromRoles(roles);

        const data = {
            displayName,
            rank,
            avatarUrl
        };

        discordMemberCache.set(userId, {
            data,
            time: Date.now()
        });

        return data;
    } catch (err) {
        console.error("Fehler beim Laden des Discord Users:", err);
        return null;
    }
}

function isDiscordAdmin(interaction) {
    const roles = interaction.member?.roles;

    if (!roles) {
        return false;
    }

    if (roles.cache) {
        return roles.cache.has(ADMIN_ROLE_ID);
    }

    if (Array.isArray(roles)) {
        return roles.includes(ADMIN_ROLE_ID);
    }

    return false;
}

async function sendSpontanePruefungenPanel() {
    if (!process.env.SPONTANE_PRUEFUNGEN_CHANNEL_ID) {
        console.log("SPONTANE_PRUEFUNGEN_CHANNEL_ID fehlt");
        return;
    }

    const channel = await botClient.channels.fetch(process.env.SPONTANE_PRUEFUNGEN_CHANNEL_ID);

    if (!channel) {
        console.log("Spontane Pr fungen Channel nicht gefunden");
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0x2563eb)
        .setTitle("?? Spontane Pr fung eintragen")
        .setDescription(
            "W hle zuerst die Pr fungsart aus.\n\n" +
            "Klicke danach auf **Antrag erstellen** und trage im Fenster die **DN** und den **Namen** des Pr flings ein.\n\n" +
            "Anschlie end wartet der Antrag auf die Entscheidung der Leitung."
        )
        .addFields(
            {
                name: "Schritt 1",
                value: "Pr fungsart ausw hlen.",
                inline: true
            },
            {
                name: "Schritt 2",
                value: "Auf Antrag erstellen klicken und DN + Name eintragen.",
                inline: true
            },
            {
                name: "Schritt 3",
                value: "Auf Entscheidung der Leitung warten.",
                inline: true
            }
        )
        .setFooter({ text: "LSMD Ausbildungssystem" })
        .setTimestamp();

    await channel.send({
        embeds: [embed],
        components: buildSpontanePanelComponents()
    });
}
async function addLog(action, data = {}, actor = null) {
    const createdAt = new Date();

    const logEntry = {
        action,
        data,
        actor,
        createdAt
    };

    await logsCollection.insertOne(logEntry);

    if (!process.env.DISCORD_LOG_WEBHOOK) {
        console.log("DISCORD_LOG_WEBHOOK fehlt");
        return;
    }

    try {
        const actorId = actor?.discordId || actor?.id || data?.userId || null;
        const actorName =
            actor?.username ||
            actor?.displayName ||
            data?.name ||
            "Unbekannt";

        let title = "LSMD Dashboard";
        let description = `${actorName} hat eine Aktion ausgefÃ¼hrt.`;
        let color = 3447003;
        let emoji = "??";

        if (action === "Login") {
            title = "Login";
            description = `${actorName} hat sich im LSMD Dashboard eingeloggt.`;
            color = 5763719;
            emoji = "??";
        }

        if (action === "Ausbildungstermin erstellt") {
            title = "Ausbildungstermin erstellt";
            description = `${actorName} hat einen neuen Ausbildungstermin eingetragen.`;
            color = 3447003;
            emoji = "??";
        }

        if (action === "Ausbildungstermin bearbeitet") {
            title = "Ausbildungstermin bearbeitet";
            description = `${actorName} hat einen Ausbildungstermin bearbeitet.`;
            color = 16705372;
            emoji = "???";
        }

        if (action === "Termin gelÃ¶scht") {
            title = "Ausbildungstermin gelÃ¶scht";
            description = `${actorName} hat einen Ausbildungstermin gelÃ¶scht.`;
            color = 15158332;
            emoji = "???";
        }

        if (action === "Dokument hinzugefÃ¼gt") {
            title = "Dokument hinzugefÃ¼gt";
            description = `${actorName} hat ein neues Dokument hinzugefÃ¼gt.`;
            color = 3066993;
            emoji = "??";
        }

        if (action === "Dokument bearbeitet") {
            title = "Dokument bearbeitet";
            description = `${actorName} hat ein Dokument bearbeitet.`;
            color = 16705372;
            emoji = "??";
        }

        if (action === "Dokument geloescht") {
            title = "Dokument gelÃ¶scht";
            description = `${actorName} hat ein Dokument gelÃ¶scht.`;
            color = 15158332;
            emoji = "???";
        }

        if (action === "Punkte hinzugefÃ¼gt" || action === "Punkte entfernt" || action === "Punkte gesetzt") {
            title = "Punkteverwaltung";
            description = `${actorName} hat Punkte im Dashboard geÃ¤ndert.`;
            color = 10181046;
            emoji = "??";
        }

        const fields = [];

        if (data.name) {
            fields.push({
                name: "Teilnehmer",
                value: String(data.name),
                inline: true
            });
        }

        if (data.title) {
            fields.push({
                name: "Dokument",
                value: String(data.title),
                inline: true
            });
        }

        if (data.type) {
            fields.push({
                name: "Kategorie",
                value: String(data.type),
                inline: true
            });
        }

        if (data.examType) {
            fields.push({
                name: "Art",
                value: String(data.examType),
                inline: true
            });
        }

        if (data.date) {
            fields.push({
                name: "Datum",
                value: String(data.date),
                inline: true
            });
        }

        if (data.time) {
            fields.push({
                name: "Uhrzeit",
                value: String(data.time),
                inline: true
            });
        }

        if (data.examiner) {
            fields.push({
                name: "Ausbilder / PrÃ¼fer",
                value: String(data.examiner),
                inline: true
            });
        }

        if (data.amount !== undefined) {
            fields.push({
                name: "Punkte",
                value: String(data.amount),
                inline: true
            });
        }

        if (data.userId) {
            fields.push({
                name: "Betroffener User",
                value: `<@${data.userId}>`,
                inline: true
            });
        }

        fields.push({
            name: "AusgefÃ¼hrt von",
            value: actorId ? `<@${actorId}>` : actorName,
            inline: true
        });

        fields.push({
            name: "Zeit",
            value: createdAt.toLocaleString("de-DE"),
            inline: true
        });

        const response = await fetch(process.env.DISCORD_LOG_WEBHOOK, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: "LSMD Dashboard Logs",
                avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",

                // EINMAL pingen, nicht doppelt
                content: "",

                allowed_mentions: {
                    parse: ["users"]
                },

                embeds: [
                    {
                        color,
                        author: {
                            name: "LSMD Dashboard System"
                        },
                        title: `${emoji} ${title}`,
                        description,
                        fields,
                        footer: {
                            text: "LSMD Dashboard"
                        },
                        timestamp: createdAt.toISOString()
                    }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Discord Webhook Fehler:", response.status, errorText);
        } else {
            console.log("Discord Log gesendet:", action);
        }
    } catch (err) {
        console.error("Discord Log konnte nicht gesendet werden:", err);
    }
}

async function getAllPoints() {
    if (pointsListCache && Date.now() - pointsListCacheTime < POINTS_LIST_CACHE_TIME) {
        return pointsListCache;
    }

    const users = await pointsCollection.find({}).sort({ points: -1 }).toArray();

    const enrichedUsers = await Promise.all(users.map(async (user) => {
        const discordInfo = await getDiscordMemberInfo(user.userId);

        if (!discordInfo) {
            return user;
        }

        if (
            user.displayName !== discordInfo.displayName ||
            user.rank !== discordInfo.rank ||
            user.avatarUrl !== discordInfo.avatarUrl
        ) {
            await pointsCollection.updateOne(
                { userId: user.userId },
                {
                    $set: {
                        displayName: discordInfo.displayName,
                        rank: discordInfo.rank,
                        avatarUrl: discordInfo.avatarUrl
                    }
                }
            );
        }

        return {
            ...user,
            displayName: discordInfo.displayName,
            rank: discordInfo.rank,
            avatarUrl: discordInfo.avatarUrl
        };
    }));

    pointsListCache = enrichedUsers;
    pointsListCacheTime = Date.now();

    return enrichedUsers;
}

botClient.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (
            !interaction.isStringSelectMenu() &&
            !interaction.isButton() &&
            !interaction.isModalSubmit()
        ) {
            return;
        }

        if (!interaction.customId.startsWith("spontan_")) {
            return;
        }

        if (!isDiscordAdmin(interaction)) {
            return interaction.reply({
                content: "Du hast keine Berechtigung f r dieses Pr fungs-Panel.",
                flags: MessageFlags.Ephemeral
            });
        }

        const adminId = interaction.user.id;
        const current = spontaneSelections.get(adminId) || {};

        if (interaction.customId.startsWith("spontan_type_")) {
            const examType = interaction.values[0];

            spontaneSelections.set(adminId, {
                ...current,
                examType
            });

            return interaction.reply({
                content: `Pr fungsart ausgew hlt: **${examType}**. Klicke jetzt auf **Antrag erstellen**.`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (interaction.customId === "spontan_submit") {
            const state = spontaneSelections.get(adminId);

            if (!state || !state.examType) {
                return interaction.reply({
                    content: "Bitte zuerst die Pr fungsart ausw hlen.",
                    flags: MessageFlags.Ephemeral
                });
            }

            spontaneSelections.set(adminId, {
                ...state,
                panelChannelId: interaction.channel.id,
                panelMessageId: interaction.message.id
            });

            const modal = new ModalBuilder()
                .setCustomId("spontan_submit_modal")
                .setTitle("Spontane Pr fung eintragen");

            const dnInput = new TextInputBuilder()
                .setCustomId("pruefling_dn")
                .setLabel("DN des Pr flings")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(30)
                .setPlaceholder("z.B. 1234");

            const nameInput = new TextInputBuilder()
                .setCustomId("pruefling_name")
                .setLabel("Name des Pr flings")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(80)
                .setPlaceholder("z.B. Max Mustermann");

            modal.addComponents(
                new ActionRowBuilder().addComponents(dnInput),
                new ActionRowBuilder().addComponents(nameInput)
            );

            return interaction.showModal(modal);
        }

        if (interaction.customId === "spontan_submit_modal") {
            const state = spontaneSelections.get(adminId);

            if (!state || !state.examType) {
                return interaction.reply({
                    content: "Die Pr fungsart fehlt. Bitte Antrag nochmal neu erstellen.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const prueflingDn = interaction.fields.getTextInputValue("pruefling_dn");
            const prueflingName = interaction.fields.getTextInputValue("pruefling_name");

            const requestId = spontaneRequestCounter++;

            const embed = new EmbedBuilder()
                .setColor(0xf59e0b)
                .setTitle("?? Neuer Antrag: Spontane Pr fung")
                .setDescription(
                    "Ein Pr fling wurde f r eine spontane Pr fung eingetragen.\n\n" +
                    "Die Leitung kann diesen Antrag jetzt genehmigen oder ablehnen."
                )
                .addFields(
                    {
                        name: "Pr fling",
                        value: `**${prueflingName}**`,
                        inline: true
                    },
                    {
                        name: "DN",
                        value: `**${prueflingDn}**`,
                        inline: true
                    },
                    {
                        name: "Pr fung",
                        value: state.examType,
                        inline: true
                    },
                    {
                        name: "Eingetragen von",
                        value: `<@${interaction.user.id}>`,
                        inline: true
                    },
                    {
                        name: "Status",
                        value: "? Wartet auf Entscheidung der Leitung",
                        inline: false
                    }
                )
                .setFooter({ text: `LSMD Ausbildungssystem   Antrag #${requestId}` })
                .setTimestamp();

            const decisionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`spontan_request_approve_${requestId}`)
                    .setLabel("Genehmigen")
                    .setEmoji("?")
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId(`spontan_request_reject_${requestId}`)
                    .setLabel("Ablehnen")
                    .setEmoji("?")
                    .setStyle(ButtonStyle.Danger)
            );

            const requestMessage = await interaction.channel.send({
                embeds: [embed],
                components: [decisionRow],
                allowedMentions: {
                    parse: []
                }
            });

            spontaneRequests.set(requestId, {
                id: requestId,
                targetName: prueflingName,
                targetDn: prueflingDn,
                examType: state.examType,
                createdBy: interaction.user.id,
                channelId: interaction.channel.id,
                messageId: requestMessage.id,
                status: "offen"
            });

            try {
                if (state.panelChannelId && state.panelMessageId) {
                    const panelChannel = await botClient.channels.fetch(state.panelChannelId);
                    const panelMessage = await panelChannel.messages.fetch(state.panelMessageId);

                    await panelMessage.edit({
                        embeds: panelMessage.embeds,
                        components: buildSpontanePanelComponents()
                    });
                }
            } catch (err) {
                console.error("Panel konnte nicht zur ckgesetzt werden:", err);
            }

            spontaneSelections.delete(adminId);

            return interaction.reply({
                content: "Der Antrag wurde unten als neue Nachricht erstellt.",
                flags: MessageFlags.Ephemeral
            });
        }

        if (interaction.customId.startsWith("spontan_request_approve_")) {
            const requestId = Number(interaction.customId.replace("spontan_request_approve_", ""));
            const request = spontaneRequests.get(requestId);

            if (!request || request.status !== "offen") {
                return interaction.reply({
                    content: "Dieser Antrag wurde bereits bearbeitet oder nicht gefunden.",
                    flags: MessageFlags.Ephemeral
                });
            }

            request.status = "genehmigt";
            request.decidedBy = interaction.user.id;

            const embed = new EmbedBuilder()
                .setColor(0x22c55e)
                .setTitle("? Spontane Pr fung genehmigt")
                .setDescription("Die Leitung hat den Antrag genehmigt.")
                .addFields(
                    {
                        name: "Pr fling",
                        value: `**${request.targetName}**`,
                        inline: true
                    },
                    {
                        name: "DN",
                        value: `**${request.targetDn}**`,
                        inline: true
                    },
                    {
                        name: "Pr fung",
                        value: request.examType,
                        inline: true
                    },
                    {
                        name: "Eingetragen von",
                        value: `<@${request.createdBy}>`,
                        inline: true
                    },
                    {
                        name: "Genehmigt von",
                        value: `<@${interaction.user.id}>`,
                        inline: true
                    },
                    {
                        name: "Status",
                        value: "? Genehmigt",
                        inline: false
                    }
                )
                .setFooter({ text: `LSMD Ausbildungssystem   Antrag #${requestId}` })
                .setTimestamp();

            await interaction.message.edit({
                embeds: [embed],
                components: []
            });

            return interaction.reply({
                content: "Der Antrag wurde genehmigt.",
                flags: MessageFlags.Ephemeral
            });
        }

        if (interaction.customId.startsWith("spontan_request_reject_")) {
            const requestId = Number(interaction.customId.replace("spontan_request_reject_", ""));
            const request = spontaneRequests.get(requestId);

            if (!request || request.status !== "offen") {
                return interaction.reply({
                    content: "Dieser Antrag wurde bereits bearbeitet oder nicht gefunden.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const modal = new ModalBuilder()
                .setCustomId(`spontan_reject_modal_${requestId}`)
                .setTitle("Spontane Pr fung ablehnen");

            const reasonInput = new TextInputBuilder()
                .setCustomId("reject_reason")
                .setLabel("Grund f r die Ablehnung")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(500)
                .setPlaceholder("z.B. Voraussetzungen fehlen, R cksprache n tig, falscher Zeitpunkt...");

            modal.addComponents(
                new ActionRowBuilder().addComponents(reasonInput)
            );

            return interaction.showModal(modal);
        }

        if (interaction.customId.startsWith("spontan_reject_modal_")) {
            const requestId = Number(interaction.customId.replace("spontan_reject_modal_", ""));
            const request = spontaneRequests.get(requestId);

            if (!request || request.status !== "offen") {
                return interaction.reply({
                    content: "Dieser Antrag wurde bereits bearbeitet oder nicht gefunden.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const reason = interaction.fields.getTextInputValue("reject_reason");

            request.status = "abgelehnt";
            request.decidedBy = interaction.user.id;
            request.reason = reason;

            const channel = await botClient.channels.fetch(request.channelId);
            const requestMessage = await channel.messages.fetch(request.messageId);

            const embed = new EmbedBuilder()
                .setColor(0xef233c)
                .setTitle("? Spontane Pr fung abgelehnt")
                .setDescription("Die Leitung hat den Antrag abgelehnt.")
                .addFields(
                    {
                        name: "Pr fling",
                        value: `**${request.targetName}**`,
                        inline: true
                    },
                    {
                        name: "DN",
                        value: `**${request.targetDn}**`,
                        inline: true
                    },
                    {
                        name: "Pr fung",
                        value: request.examType,
                        inline: true
                    },
                    {
                        name: "Eingetragen von",
                        value: `<@${request.createdBy}>`,
                        inline: true
                    },
                    {
                        name: "Abgelehnt von",
                        value: `<@${interaction.user.id}>`,
                        inline: true
                    },
                    {
                        name: "Grund",
                        value: reason,
                        inline: false
                    },
                    {
                        name: "Status",
                        value: "? Abgelehnt",
                        inline: false
                    }
                )
                .setFooter({ text: `LSMD Ausbildungssystem   Antrag #${requestId}` })
                .setTimestamp();

            await requestMessage.edit({
                embeds: [embed],
                components: []
            });

            return interaction.reply({
                content: "Der Antrag wurde abgelehnt und der Grund wurde eingetragen.",
                flags: MessageFlags.Ephemeral
            });
        }
    } catch (err) {
        console.error("Fehler bei Spontane-Pr fungen Interaction:", err);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "Es ist ein Fehler aufgetreten.",
                flags: MessageFlags.Ephemeral
            });
        }
    }
});

// =====================
// LOGIN
// =====================

app.get("/login", (req, res) => {
    res.render("login", {
        layout: false,
        error: null
    });
});

app.get("/auth/discord", passport.authenticate("discord"));

app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", {
        failureRedirect: "/login"
    }),
    async (req, res) => {
        req.session.loggedIn = true;
        req.session.isAdmin = req.user.isAdmin;

        req.session.user = {
            username: req.user.username,
            discordId: req.user.id,
            role: req.user.role,
            rank: req.user.rank,
avatar: req.user.avatar || null
        };

        await pointsCollection.updateOne(
            { userId: req.user.id },
            {
                $set: {
                    userId: req.user.id,
                    displayName: req.user.username,
                    rank: req.user.rank
                },
                $setOnInsert: {
                    points: 0
                }
            },
            { upsert: true }
        );

await addLog("Login", {
    userId: req.user.id,
    name: req.user.username
}, req.session.user);

        res.redirect("/dashboard");
    }
);

app.get("/logout", (req, res) => {
    req.logout(() => {
        req.session.destroy(() => {
            res.redirect("/login");
        });
    });
});

// =====================
// SEITEN
// =====================

app.get("/", requireLogin, (req, res) => {
    res.redirect("/dashboard");
});

app.get("/dashboard", requireLogin, async (req, res) => {
    const users = await getAllPoints();

    const termine = await termineCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();

    const allTermine = await termineCollection
        .find({})
        .toArray();

    const docs = await docsCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

    res.render("dashboard", viewData(req, {
        active: "dashboard",
        users,
        termine,
        allTermine,
        docs,
        mdName: req.session.user?.username || "Ausbilder"
    }));
});

app.get("/leaderboard", requireLogin, async (req, res) => {
    const users = await getAllPoints();

    res.render("leaderboard", viewData(req, {
        active: "leaderboard",
        users
    }));
});

app.get("/users", requireLogin, async (req, res) => {
    const users = await getAllPoints();

    res.render("users", viewData(req, {
        active: "users",
        users
    }));
});

app.get("/termine", requireLogin, async (req, res) => {
    const termine = await termineCollection.find({}).sort({ date: 1, time: 1 }).toArray();

const selectedMonth = Number(req.query.month);
const selectedYear = Number(req.query.year);

const today = new Date();

const calendarMonth = !isNaN(selectedMonth) ? selectedMonth : today.getMonth();
const calendarYear = !isNaN(selectedYear) ? selectedYear : today.getFullYear();

res.render("termine", viewData(req, {
    active: "termine",
    termine,
    calendarMonth,
    calendarYear
}));

    res.render("termine", viewData(req, {
        active: "termine",
        termine
    }));
});


app.get("/dokumente", requireLogin, async (req, res) => {
    const docs = await docsCollection.find({}).sort({ createdAt: -1 }).toArray();

    res.render("dokumente", viewData(req, {
        active: "dokumente",
        docs
    }));
});

app.get("/admin", requireLogin, requireAdmin, async (req, res) => {
    const [users, logs] = await Promise.all([
        getAllPoints(),
        logsCollection.find({}).sort({ createdAt: -1 }).limit(50).toArray()
    ]);

    res.render("admin", viewData(req, {
        active: "admin",
        users,
        logs
    }));
});

app.post("/admin/spontane-panel", requireLogin, requireAdmin, async (req, res) => {
    await sendSpontanePruefungenPanel();

    await addLog("Spontane Pr fungen Panel gesendet", {
        channelId: process.env.SPONTANE_PRUEFUNGEN_CHANNEL_ID
    }, req.session.user);

    res.redirect("/admin");
});

function buildSpontanePanelComponents() {
    const resetId = Date.now();

    const typeRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`spontan_type_${resetId}`)
            .setPlaceholder("Pr fungsart ausw hlen")
            .addOptions(
                {
                    label: "Sanit ter Pr fung",
                    value: "Sanit ter Pr fung",
                    emoji: "??"
                }
            )
    );

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("spontan_submit")
            .setLabel("Antrag erstellen")
            .setEmoji("??")
            .setStyle(ButtonStyle.Primary)
    );

    return [typeRow, buttonRow];
}

// =====================
// POINTS
// =====================

app.post("/points/add", requireLogin, requireAdmin, async (req, res) => {
    const { userId, points } = req.body;
    const amount = Number(points);

    if (!userId || isNaN(amount)) {
        return res.redirect("/admin");
    }

    await pointsCollection.updateOne(
        { userId },
        { $inc: { points: amount }, $set: { userId } },
        { upsert: true }
    );

    await addLog("Punkte hinzugefuegt", { userId, amount }, req.session.user);

pointsListCache = null;

res.redirect("/admin");
});

app.post("/points/remove", requireLogin, requireAdmin, async (req, res) => {
    const { userId, points } = req.body;
    const amount = Number(points);

    if (!userId || isNaN(amount)) {
        return res.redirect("/admin");
    }

    const user = await pointsCollection.findOne({ userId });
    const current = user?.points || 0;
    const newPoints = Math.max(0, current - amount);

    await pointsCollection.updateOne(
        { userId },
        { $set: { userId, points: newPoints } },
        { upsert: true }
    );

    await addLog("Punkte entfernt", { userId, amount }, req.session.user);

pointsListCache = null;

res.redirect("/admin");
});

app.post("/points/set", requireLogin, requireAdmin, async (req, res) => {
    const { userId, points } = req.body;
    const amount = Math.max(0, Number(points));

    if (!userId || isNaN(amount)) {
        return res.redirect("/admin");
    }

    await pointsCollection.updateOne(
        { userId },
        { $set: { userId, points: amount } },
        { upsert: true }
    );

    await addLog("Punkte gesetzt", { userId, amount }, req.session.user);

pointsListCache = null;

res.redirect("/admin");
});

// =====================
// TERMINE
// =====================

app.post("/termine/create", requireLogin, async (req, res) => {
    try {
        const {
            name,
            examType,
            date,
            time,
            examiner,
            notes
        } = req.body;

        if (!name || !examType || !date || !examiner) {
            return res.redirect("/termine");
        }

        await termineCollection.insertOne({
            name,
            discordId: "",
            examType,
            date,
            time,
            examiner,
            status: "Offen",
            notes,
            source: "termine",
            createdAt: new Date()
        });

        await addLog("Ausbildungstermin erstellt", {
            name,
            examType,
            date,
            time,
            examiner,
            notes
        }, req.session.user);

        res.redirect("/termine");
    } catch (err) {
        console.error("Fehler beim Erstellen des Termins:", err);
        res.status(500).send("Serverfehler");
    }
});

app.get("/termine/edit/:id", requireLogin, requireAdmin, async (req, res) => {
    try {
        const termin = await termineCollection.findOne({
            _id: new ObjectId(req.params.id)
        });

        if (!termin) {
            return res.redirect("/termine");
        }

        res.render("termin-edit", viewData(req, {
            active: "termine",
            termin
        }));
    } catch (err) {
        console.error("Fehler beim Laden des Termins:", err);
        res.status(500).send("Serverfehler");
    }
});

app.post("/termine/edit/:id", requireLogin, requireAdmin, async (req, res) => {
    try {
        const {
            name,
            examType,
            date,
            time,
            examiner,
            notes
        } = req.body;

        if (!name || !examType || !date || !examiner) {
            return res.redirect("/termine/edit/" + req.params.id);
        }

        await termineCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            {
                $set: {
                    name,
                    examType,
                    date,
                    time,
                    examiner,
                    notes
                }
            }
        );

        await addLog("Ausbildungstermin bearbeitet", {
            id: req.params.id,
            name,
            examType,
            date,
            time,
            examiner,
            notes
        }, req.session.user);

        res.redirect("/termine");
    } catch (err) {
        console.error("Fehler beim Bearbeiten des Termins:", err);
        res.status(500).send("Serverfehler");
    }
});

app.post("/termine/status/:id", requireLogin, async (req, res) => {
    try {
        await termineCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            {
                $set: {
                    status: req.body.status || "Offen"
                }
            }
        );

        res.redirect("/termine");
    } catch (err) {
        console.error("Fehler beim Status-Update:", err);
        res.status(500).send("Serverfehler");
    }
});

app.post("/termine/delete/:id", requireLogin, requireAdmin, async (req, res) => {
    try {
        const termin = await termineCollection.findOne({
            _id: new ObjectId(req.params.id)
        });

        await termineCollection.deleteOne({
            _id: new ObjectId(req.params.id)
        });

        await addLog("Termin geloescht", {
            id: req.params.id,
            name: termin?.name,
            examType: termin?.examType,
            date: termin?.date,
            time: termin?.time,
            examiner: termin?.examiner
        }, req.session.user);

        res.redirect("/termine");
    } catch (err) {
        console.error("Fehler beim Loeschen des Termins:", err);
        res.status(500).send("Serverfehler");
    }
});
// DOKUMENTE
// =====================

app.post("/dokumente/create", requireLogin, requireAdmin, async (req, res) => {
    const { title, type, url, notes } = req.body;

    await docsCollection.insertOne({
        title,
        type,
        url,
        notes,
        createdAt: new Date()
    });

    await addLog("Dokument hinzugefuegt", { title, type }, req.session.user);

    res.redirect("/dokumente");
});

app.get("/dokumente/edit/:id", requireLogin, requireAdmin, async (req, res) => {
    try {
        const doc = await docsCollection.findOne({
            _id: new ObjectId(req.params.id)
        });

        if (!doc) {
            return res.status(404).send("Dokument nicht gefunden");
        }

        res.render("dokument-edit", viewData(req, {
            active: "dokumente",
            doc
        }));
    } catch (err) {
        console.error("Fehler beim Laden des Dokuments:", err);
        res.status(500).send("Serverfehler");
    }
});

app.post("/dokumente/edit/:id", requireLogin, requireAdmin, async (req, res) => {
    try {
        const { title, type, url, notes } = req.body;

        await docsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            {
                $set: {
                    title,
                    type,
                    url,
                    notes
                }
            }
        );

        await addLog("Dokument bearbeitet", {
    id: req.params.id,
    title,
    type
}, req.session.user);

        res.redirect("/dokumente");
    } catch (err) {
        console.error("Fehler beim Speichern des Dokuments:", err);
        res.status(500).send("Serverfehler");
    }
});

app.post("/dokumente/delete/:id", requireLogin, requireAdmin, async (req, res) => {
    try {
        await docsCollection.deleteOne({
            _id: new ObjectId(req.params.id)
        });

        await addLog("Dokument geloescht", { id: req.params.id }, req.session.user);

        res.redirect("/dokumente");
    } catch (err) {
        console.error("Fehler beim Loeschen des Dokuments:", err);
        res.status(500).send("Serverfehler");
    }
});

// =====================
// START
// =====================

async function start() {
    await mongo.connect();

    const db = mongo.db("lsmd");

    pointsCollection = db.collection("points");
    termineCollection = db.collection("examAppointments");
    examsCollection = db.collection("exams");
    docsCollection = db.collection("documents");
    logsCollection = db.collection("dashboardLogs");

await pointsCollection.createIndex({ points: -1 });
await pointsCollection.createIndex({ userId: 1 });

await termineCollection.createIndex({ date: 1, time: 1 });
await termineCollection.createIndex({ createdAt: -1 });

await docsCollection.createIndex({ createdAt: -1 });

await logsCollection.createIndex({ createdAt: -1 });

if (process.env.DISCORD_BOT_TOKEN) {
    botClient.login(process.env.DISCORD_BOT_TOKEN)
        .then(() => {
            console.log("Discord Bot ist online");
        })
        .catch((err) => {
            console.error("Discord Bot Login Fehler:", err);
        });
}

    app.listen(PORT, () => {
        console.log(`LSMD Website laeuft auf Port ${PORT}`);
    });
}

start().catch(console.error);




