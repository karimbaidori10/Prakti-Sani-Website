
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
let einstellungsBonusCollection;
let overwatchLicensesCollection;

const discordMemberCache = new Map();
const DISCORD_CACHE_TIME = 1000 * 60 * 10;

let pointsListCache = null;
let pointsListCacheTime = 0;
const POINTS_LIST_CACHE_TIME = 1000 * 30;

const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const PRAKTI_SANI_ROLE_ID = process.env.PRAKTI_SANI_ROLE_ID;
const WEBSITE_KEY_ROLE_ID = process.env.WEBSITE_KEY_ROLE_ID;
const ROLE_TESTPHASE = process.env.PRAKTI_SANI_ROLE_ID;
const ROLE_FESTES_MITGLIED = process.env.ROLE_FESTES_MITGLIED;
const ROLE_SENIOR = process.env.ROLE_SENIOR;
const ROLE_UNTERE_LEITUNG = process.env.ROLE_UNTERE_LEITUNG;
const ROLE_STV_LEITUNG = process.env.ROLE_STV_LEITUNG;
const ROLE_LEITUNG = process.env.ROLE_LEITUNG;
const ROLE_OVERWATCH_LEITUNG = process.env.ROLE_OVERWATCH_LEITUNG;
const ROLE_OVERWATCH_LICENSE_EDIT = process.env.ROLE_OVERWATCH_LICENSE_EDIT;
const BONUS_HQ_CHANNEL_ID = process.env.BONUS_HQ_CHANNEL_ID;
const BONUS_WEEKLY_PING_ROLE_ID = process.env.BONUS_WEEKLY_PING_ROLE_ID || PRAKTI_SANI_ROLE_ID;
const JOB_ANNOUNCE_CHANNEL_ID = process.env.JOB_ANNOUNCE_CHANNEL_ID;
const DOKUMENTE_WEBHOOK_URL = process.env.DOKUMENTE_WEBHOOK_URL;
const PROFESSOREN_DOKUMENTE_WEBHOOK_URL = process.env.PROFESSOREN_DOKUMENTE_WEBHOOK_URL;
const JOB_ANNOUNCE_PING_ROLE_ID = process.env.JOB_ANNOUNCE_PING_ROLE_ID || PRAKTI_SANI_ROLE_ID;
const BEWERBUNG_CHANNEL_ID = process.env.BEWERBUNG_CHANNEL_ID;
const OVERWATCH_PANEL_CHANNEL_ID = process.env.OVERWATCH_PANEL_CHANNEL_ID;
const OVERWATCH_REMINDER_CHANNEL_ID = process.env.OVERWATCH_REMINDER_CHANNEL_ID;
const OVERWATCH_LOG_CHANNEL_ID = process.env.OVERWATCH_LOG_CHANNEL_ID;
const PROFESSOREN_SCHUELER_SYSTEM_CHANNEL_ID = process.env.PROFESSOREN_SCHUELER_SYSTEM_CHANNEL_ID;
const PROFESSOREN_SCHUELER_SYSTEM_MESSAGE_ID = process.env.PROFESSOREN_SCHUELER_SYSTEM_MESSAGE_ID;
const PROFESSOREN_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxYFD8sbuLVSd6SE6FDitRnFTyt91yzYgnWQdSP_hK-8VFaVz55iD8XWhdlTmgabTkyew/exec";
const PROFESSOREN_SHEET_SECRET = "LSMD_PROFESSOREN_SECRET_123";
const PROFESSOREN_SCHUELER_LOG_CHANNEL_ID = process.env.PROFESSOREN_SCHUELER_LOG_CHANNEL_ID;
const PROFESSOREN_LEITUNG_LOG_CHANNEL_ID = process.env.PROFESSOREN_LEITUNG_LOG_CHANNEL_ID;
const LSMD_LOGO_URL = "https://cdn.discordapp.com/attachments/1461110262395310160/1514333137487003790/p7NyS81.png?ex=6a2afc22&is=6a29aaa2&hm=b4ff181b7f8052507370699cf1024fc42b20330a20d09ed785366da8d1bfb8e1&";
const AUSBILDUNG_LOGO_URL = process.env.AUSBILDUNG_LOGO_URL || "https://cdn.discordapp.com/attachments/1461110262395310160/1514910893488734309/image-removebg-preview.png?ex=6a2d1636&is=6a2bc4b6&hm=06d8d018bd420b5428dda8375ee88bde7d19eccf6ade38ad95106c0388ceacb7&";
const AUSBILDUNG_FOOTER_LOGO_URL = process.env.AUSBILDUNG_FOOTER_LOGO_URL || "https://cdn.discordapp.com/attachments/1461110262395310160/1514906419336314992/md_logo.png?ex=6a2d120b&is=6a2bc08b&hm=97e63207a01832553278f6d09952fc3b0ca488efc3ba2c4bdba787655633a293&";

async function updateProfessorPointsInSheet(professorDn, points) {
  try {
    const res = await fetch(PROFESSOREN_SHEET_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        secret: PROFESSOREN_SHEET_SECRET,
        professorDn,
        points
      })
    });

    const data = await res.json();

    if (!data.success) {
      console.log("Google Sheet Punkte Fehler:", data.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error("Fehler beim Aktualisieren der Professoren-Punkte im Sheet:", err);
    return null;
  }
}

async function professorSheetAction(professorDn, action, points = 0) {
  try {
    const res = await fetch(PROFESSOREN_SHEET_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        secret: PROFESSOREN_SHEET_SECRET,
        professorDn,
        action,
        points
      })
    });

    const data = await res.json();

    if (!data.success) {
      console.log("Professoren Sheet Aktion Fehler:", data.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error("Fehler bei Professoren Sheet Aktion:", err);
    return null;
  }
}

function extractDnFromName(name) {
    if (!name) {
        return null;
    }

    const match = String(name).match(/MD[\s-]*(\d+)/i);

    if (!match) {
        return null;
    }

    return match[1];
}

const BEWERBUNG_PING_ROLE_IDS = [
    ROLE_UNTERE_LEITUNG,
    ROLE_STV_LEITUNG,
    ROLE_LEITUNG
].filter(Boolean);

const BEWERBUNG_REQUIRED_VOTES = Number(process.env.BEWERBUNG_REQUIRED_VOTES || 3);

let lastJobAnnounceReminderHour = null;

const EINSTELLUNGS_BONUS = 250000;
const EINSTELLUNGS_BONUS_LIMIT = 3000000;

const botClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const spontaneSelections = new Map();
const spontaneRequests = new Map();
let spontaneRequestCounter = 1;

const bonusHelperSelections = new Map();

const bewerbungRequests = new Map();
let bewerbungRequestCounter = 1;

const profLogSelections = new Map();
const attestTempData = new Map();
const overwatchTempData = new Map();

const OVERWATCH_LICENSE_TYPES = [
    "Overwatch",
    "Overwatch+",
    "Osprey"
];

const OVERWATCH_YELLOW_DAYS = 12;
const OVERWATCH_RED_DAYS = 25;

const attestListe = {
    klaustro_1: {
        name: "Klaustrophobie Variante 1",
        gueltigkeit: "1 Monat",
        inhalt: "Patient darf in keine Einzelhaft gesteckt werden.",
        stunden: "2"
    },
    klaustro_2: {
        name: "Klaustrophobie Variante 2",
        gueltigkeit: "1 Monat",
        inhalt: "Patient darf maximal mit einer Person gleichzeitig im Auto sitzen.",
        stunden: "3"
    },
    soziale_angst: {
        name: "Soziale Angststörung",
        gueltigkeit: "1 Monat",
        inhalt: "Patient darf jederzeit eine Maske tragen.",
        stunden: "3"
    },
    depression: {
        name: "Depression",
        gueltigkeit: "1 Monat",
        inhalt: "Patient darf Weed bei sich tragen max. 3g.",
        stunden: "3"
    },
    existenzangst: {
        name: "Existenzangst",
        gueltigkeit: "1 Woche",
        inhalt: "Patient darf bis max. Visumstufe 10 die Hälfte des Rechnungsbetrags bekommen.",
        stunden: "3"
    },
    ruhezeit_staatsfraktion: {
        name: "Ruhezeit Staatsfraktion",
        gueltigkeit: "1 Woche",
        inhalt: "Patient darf Dienstpflicht missachten. Die Leitung muss informiert werden.",
        stunden: "2"
    }
};


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
        const hasWebsiteKey = roles.includes(WEBSITE_KEY_ROLE_ID);
        const isOverwatchLeitung = roles.includes(ROLE_OVERWATCH_LEITUNG);
        const canEditOverwatchRole = roles.includes(ROLE_OVERWATCH_LICENSE_EDIT);
        const rank = getRankFromRoles(roles);


        if (
    !isAdmin &&
    !isPraktiSani &&
    !hasWebsiteKey &&
    !isOverwatchLeitung &&
    !canEditOverwatchRole
) {
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
    isViewOnly: hasWebsiteKey && !isAdmin && !isPraktiSani && !isOverwatchLeitung && !canEditOverwatchRole,
    role: isAdmin
        ? "Admin"
        : isOverwatchLeitung
            ? "Overwatch Leitung"
            : canEditOverwatchRole
                ? "Lizenz bearbeiten Overwatch"
                : hasWebsiteKey
                    ? "Website Schlüssel"
                    : "Prakti-Sani",
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
        return res.status(403).send("Werd Leitung hier dann darfst reinschnuppern Höhöhö.");
    }

    next();
}

function requireAusbilderOrAdmin(req, res, next) {
    if (req.session.isAdmin) {
        return next();
    }

    const userRole = req.session.user?.role || "";
    const userRank = req.session.user?.rank || "";

    const allowedRoles = [
        "Prakti-Sani"
    ];

    const allowedRanks = [
        "Prakti-Sani Testphase",
        "Prakti-Sani Festes Mitglied",
        "Senior Prakti-Sani",
        "Untere Leitung",
        "Stv Leitung",
        "Leitung"
    ];

    if (allowedRoles.includes(userRole) || allowedRanks.includes(userRank)) {
        return next();
    }

    return res.status(403).send("Kein Zugriff auf diese Funktion.");
}

function canUseOverwatchWebsite(req) {
    if (req.session.isAdmin) {
        return true;
    }

    const roles = req.session.user?.roles || [];

    return [
        ROLE_OVERWATCH_LEITUNG,
        ROLE_OVERWATCH_LICENSE_EDIT
    ].filter(Boolean).some(roleId => roles.includes(roleId));
}

function requireOverwatchOrAdmin(req, res, next) {
    if (canUseOverwatchWebsite(req)) {
        return next();
    }

    return res.status(403).send("Kein Zugriff auf das Overwatch-System.");
}

function viewData(req, extra = {}) {
    return {
        user: req.session.user || null,
        isAdmin: req.session.isAdmin || false,
        isViewOnly: req.session.user?.isViewOnly || false,
        canEditOverwatch: canUseOverwatchWebsite(req),
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

async function getPraktiSaniAusbilderOptions() {
    try {
        const guild = await botClient.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(() => null);

        if (!guild) {
            console.log("Guild nicht gefunden für Ausbilder Dropdown");
            return [];
        }

        await fetchGuildMembersSafe(guild);

        const allowedRoles = [
            ADMIN_ROLE_ID,
            PRAKTI_SANI_ROLE_ID,
            ROLE_TESTPHASE,
            ROLE_FESTES_MITGLIED,
            ROLE_SENIOR,
            ROLE_UNTERE_LEITUNG,
            ROLE_STV_LEITUNG,
            ROLE_LEITUNG
        ].filter(Boolean);

        const members = Array.from(guild.members.cache.values())
            .filter(member => !member.user.bot)
            .filter(member => allowedRoles.some(roleId => member.roles.cache.has(roleId)))
            .map(member => ({
                id: member.id,
                name:
                    member.displayName ||
                    member.user.globalName ||
                    member.user.username ||
                    member.id
            }))
            .sort((a, b) => a.name.localeCompare(b.name, "de"));

        return members;
    } catch (err) {
        console.error("Fehler beim Laden der Ausbilder-Liste:", err);
        return [];
    }
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



    const allowedRoles = [
        ADMIN_ROLE_ID,
    ].filter(Boolean);

    if (roles.cache) {
        return allowedRoles.some(roleId => roles.cache.has(roleId));
    }

    if (Array.isArray(roles)) {
        return allowedRoles.some(roleId => roles.includes(roleId));
    }

    return false;
}

function canUseSpontanePanel(interaction) {
    const roles = interaction.member?.roles;

    if (!roles) {
        return false;
    }

    const allowedRoles = [
        ADMIN_ROLE_ID,
        PRAKTI_SANI_ROLE_ID,
        process.env.ROLE_HEAD_PRAKTI_SANI,
        process.env.ROLE_LEITUNG,
        process.env.ROLE_STV_LEITUNG,
        process.env.ROLE_UNTERE_LEITUNG,
        process.env.ROLE_SENIOR,
        process.env.ROLE_FESTES_MITGLIED,
        process.env.ROLE_TESTPHASE,
        process.env.ROLE_AUSHILFE
    ].filter(Boolean);

    if (roles.cache) {
        return allowedRoles.some(roleId => roles.cache.has(roleId));
    }

    if (Array.isArray(roles)) {
        return allowedRoles.some(roleId => roles.includes(roleId));
    }

    return false;
}

function isDiscordLeadership(interaction) {
    const roles = interaction.member?.roles;

    if (!roles) {
        return false;
    }

    const allowedRoles = [
        ADMIN_ROLE_ID,
        process.env.ROLE_HEAD_PRAKTI_SANI,
        process.env.ROLE_LEITUNG,
        process.env.ROLE_STV_LEITUNG,
        process.env.ROLE_UNTERE_LEITUNG
    ].filter(Boolean);

    if (roles.cache) {
        return allowedRoles.some(roleId => roles.cache.has(roleId));
    }

    if (Array.isArray(roles)) {
        return allowedRoles.some(roleId => roles.includes(roleId));
    }

    return false;
}

function canUseOverwatchDiscord(interaction) {
    const roles = interaction.member?.roles;

    if (!roles) {
        return false;
    }

    const allowedRoles = [
        ADMIN_ROLE_ID,
        ROLE_OVERWATCH_LEITUNG,
        ROLE_OVERWATCH_LICENSE_EDIT
    ].filter(Boolean);

    if (roles.cache) {
        return allowedRoles.some(roleId => roles.cache.has(roleId));
    }

    if (Array.isArray(roles)) {
        return allowedRoles.some(roleId => roles.includes(roleId));
    }

    return false;
}

function isProfessorenLeitung(interaction) {
    const roles = interaction.member?.roles;

    if (!roles) {
        return false;
    }

    const allowedRoles = [
        process.env.ROLE_PROFESSOREN_LEITUNG
    ].filter(Boolean);

    if (roles.cache) {
        return allowedRoles.some(roleId => roles.cache.has(roleId));
    }

    if (Array.isArray(roles)) {
        return allowedRoles.some(roleId => roles.includes(roleId));
    }

    return false;
}

async function getAusbilderBonusStand(ausbilderDiscordId) {
    const result = await einstellungsBonusCollection.aggregate([
        {
            $match: {
                ausbilderDiscordId,
                status: "ausgezahlt"
            }
        },
        {
            $group: {
                _id: "$ausbilderDiscordId",
                total: {
                    $sum: "$bonus"
                }
            }
        }
    ]).toArray();

    return result[0]?.total || 0;
}

async function sendEinstellungsBonusRequest(interaction, data) {
    if (!BONUS_HQ_CHANNEL_ID) {
        console.log("BONUS_HQ_CHANNEL_ID fehlt");
        return null;
    }

    const helperId = data.helperId || null;
    const hasHelper = helperId && helperId !== interaction.user.id;

    const participants = hasHelper
        ? [
            {
                discordId: interaction.user.id,
                name: interaction.user.tag,
                label: "Hauptausbilder"
            },
            {
                discordId: helperId,
                name: `Helper ${helperId}`,
                label: "Helfer"
            }
        ]
        : [
            {
                discordId: interaction.user.id,
                name: interaction.user.tag,
                label: "Ausbilder"
            }
        ];

    const bonusProPerson = hasHelper ? 125000 : EINSTELLUNGS_BONUS;

    for (const participant of participants) {
        const stand = await getAusbilderBonusStand(participant.discordId);

        if (stand >= EINSTELLUNGS_BONUS_LIMIT) {
            return null;
        }

        if (stand + bonusProPerson > EINSTELLUNGS_BONUS_LIMIT) {
            return null;
        }
    }

    const bonusChannel = await botClient.channels.fetch(BONUS_HQ_CHANNEL_ID);

    if (!bonusChannel) {
        console.log("Bonus-HQ Channel nicht gefunden");
        return null;
    }

    const requestGroupId = new ObjectId().toString();
    const createdAt = new Date();

    const docs = participants.map(participant => ({
        requestGroupId,
        ausbilderDiscordId: participant.discordId,
        ausbilderName: participant.name,
        eingestellterName: data.name,
        eingestellterDN: data.dn,
        bonus: bonusProPerson,
        status: "offen",
        messageId: null,
        paidBy: null,
        paidAt: null,
        createdAt,
        updatedAt: createdAt
    }));

    const insertResult = await einstellungsBonusCollection.insertMany(docs);
    const mainBonusId = Object.values(insertResult.insertedIds)[0].toString();

    const mainStand = await getAusbilderBonusStand(interaction.user.id);
    const helperStand = hasHelper ? await getAusbilderBonusStand(helperId) : null;

    const fields = [
        {
            name: "👤 Eingestellter",
            value: `DN ${data.dn} | ${data.name}`,
            inline: false
        },
        {
            name: hasHelper ? "👨‍🏫 Hauptausbilder" : "👨‍🏫 Ausbilder",
            value: `<@${interaction.user.id}>`,
            inline: true
        },
        {
            name: "💰 Bonus",
            value: hasHelper
                ? "125.000 $ pro Person"
                : `${EINSTELLUNGS_BONUS.toLocaleString("de-DE")} $`,
            inline: true
        }
    ];

    if (hasHelper) {
        fields.push({
            name: "🤝 Helfer",
            value: `<@${helperId}>`,
            inline: true
        });
    }

    fields.push({
        name: "📊 Stand Hauptausbilder",
        value: `${mainStand.toLocaleString("de-DE")} $ / ${EINSTELLUNGS_BONUS_LIMIT.toLocaleString("de-DE")} $`,
        inline: false
    });

    if (hasHelper) {
        fields.push({
            name: "📊 Stand Helfer",
            value: `${helperStand.toLocaleString("de-DE")} $ / ${EINSTELLUNGS_BONUS_LIMIT.toLocaleString("de-DE")} $`,
            inline: false
        });
    }

    fields.push({
        name: "📌 Status",
        value: "⏳ Wartet auf Auszahlung durch die Leitung",
        inline: false
    });

    const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("💸 Einstellungsbonus beantragt")
        .addFields(fields)
        .setFooter({ text: "LSMD Einstellungsbonus" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`einstellung_bonus_paid_${mainBonusId}`)
            .setLabel("Ausgezahlt")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId(`einstellung_bonus_reject_${mainBonusId}`)
            .setLabel("Ablehnen")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger)
    );

    const message = await bonusChannel.send({
        content: ADMIN_ROLE_ID ? `<@&${ADMIN_ROLE_ID}>` : "",
        embeds: [embed],
        components: [row],
        allowedMentions: {
            roles: ADMIN_ROLE_ID ? [ADMIN_ROLE_ID] : []
        }
    });

    await einstellungsBonusCollection.updateMany(
        { requestGroupId },
        {
            $set: {
                messageId: message.id,
                updatedAt: new Date()
            }
        }
    );

    return requestGroupId;
}

async function sendEinstellungsBonusPanel() {
    if (!BONUS_HQ_CHANNEL_ID) {
        console.log("BONUS_HQ_CHANNEL_ID fehlt");
        return;
    }

    const channel = await botClient.channels.fetch(BONUS_HQ_CHANNEL_ID);

    if (!channel) {
        console.log("Bonus-HQ Channel nicht gefunden");
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("💸 LSMD Einstellungsbonus")
        .setDescription(
            "**Hier können Ausbilder ihren Einstellungsbonus beantragen.**\n\n" +
            "Pro erfolgreicher Einstellung erhält der Ausbilder einen Bonus von **250.000 $**.\n\n" +
            "**Limit:** Jeder Ausbilder kann maximal **3.000.000 $** Einstellungsbonus erhalten.\n\n" +
            "Wenn das Limit erreicht ist, wird kein weiterer Bonus-Antrag mehr erstellt."
        )
        .addFields(
            {
                name: "📋 Benötigte Angaben",
                value:
                    "**Dienstnummer des Eingestellten**\n" +
                    "**Name des Eingestellten**",
                inline: false
            },
            {
                name: "💰 Bonus",
                value: "250.000 $ pro Einstellung",
                inline: true
            },
            {
                name: "📊 Maximalbetrag",
                value: "3.000.000 $ pro Ausbilder",
                inline: true
            }
        )
        .setFooter({ text: "LSMD Einstellungsbonus • Automatische Vorlage" })
        .setTimestamp();

const helperRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
        .setCustomId("einstellung_bonus_helper_select")
        .setPlaceholder("Optional: Helfer auswählen")
        .setMinValues(0)
        .setMaxValues(1)
);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("einstellung_bonus_open_modal")
            .setLabel("Bonus beantragen")
            .setEmoji("💸")
            .setStyle(ButtonStyle.Primary)
    );

    await channel.send({
        embeds: [embed],
        components: [helperRow, row],
        allowedMentions: {
            parse: []
        }
    });

    console.log("Einstellungsbonus-Panel gesendet");
}

async function sendWeeklyBonusAnnouncement() {
    if (!BONUS_HQ_CHANNEL_ID) {
        console.log("BONUS_HQ_CHANNEL_ID fehlt");
        return;
    }

    const cycleStart = getBonusCycleStart();
    const cycleKey = cycleStart.toISOString();

    const alreadySent = await einstellungsBonusCollection.findOne({
        type: "weekly_bonus_announcement",
        cycleKey
    });

    if (alreadySent) {
        return;
    }

    const channel = await botClient.channels.fetch(BONUS_HQ_CHANNEL_ID);

    if (!channel) {
        console.log("Bonus-HQ Channel nicht gefunden");
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("💸 Neue Bonuswoche gestartet")
        .setDescription(
            "**Ab jetzt beginnt eine neue Einstellungsbonus-Woche.**\n\n" +
            "Alle Ausbilder können wieder Einstellungsboni sammeln.\n\n" +
            "**Limit:** 3.000.000 $ pro Ausbilder\n" +
            "**Bonus:** 250.000 $ pro Einstellung\n" +
            "**Mit Helfer:** 125.000 $ pro Person"
        )
        .addFields(
            {
                name: "📅 Reset-Zeitpunkt",
                value: "Jeden Sonntag um **20:00 Uhr**",
                inline: false
            },
            {
                name: "📌 Hinweis",
                value: "Alte Auszahlungen bleiben gespeichert, zählen aber nicht mehr für die neue Woche.",
                inline: false
            }
        )
        .setFooter({ text: "LSMD Einstellungsbonus • Neue Woche" })
        .setTimestamp();

    await channel.send({
        content: BONUS_WEEKLY_PING_ROLE_ID ? `<@&${BONUS_WEEKLY_PING_ROLE_ID}>` : "",
        embeds: [embed],
        allowedMentions: {
            roles: BONUS_WEEKLY_PING_ROLE_ID ? [BONUS_WEEKLY_PING_ROLE_ID] : []
        }
    });

    await einstellungsBonusCollection.insertOne({
        type: "weekly_bonus_announcement",
        cycleKey,
        createdAt: new Date()
    });

    console.log("Neue Bonuswoche Nachricht gesendet");
}

function startWeeklyBonusAnnouncementWatcher() {
    setInterval(async () => {
        try {
            const berlin = getBerlinParts(new Date());

            if (
                berlin.weekday === "Sun" &&
                berlin.hour === 20 &&
                berlin.minute < 10
            ) {
                await sendWeeklyBonusAnnouncement();
            }
        } catch (err) {
            console.error("Bonuswochen-Ankündigung Fehler:", err);
        }
    }, 60 * 1000);
}

function getBerlinParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Berlin",
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).formatToParts(date);

    const get = (type) => parts.find(part => part.type === type)?.value;

    return {
        weekday: get("weekday"),
        year: Number(get("year")),
        month: Number(get("month")),
        day: Number(get("day")),
        hour: Number(get("hour")),
        minute: Number(get("minute")),
        second: Number(get("second"))
    };
}

function getJobAnnounceText() {
    const berlin = getBerlinParts(new Date());
    const hour = berlin.hour;

    if (hour < 17) {
        return `
Das LSMD öffnet die mündliche Bewerbungsphase.
 Wenn du Lust auf medizinische Szenarien hast - dann bewirb dich noch heute! Führerscheinpflicht: PKW & LKW.`;
    }

    if (hour >= 17 && hour < 22) {
        return `
 Die Bewerbungsphase für das Medical Department ist jetzt geöffnet!
  Du willst Leben retten, Teil eines engagierten Teams sein & echtes RP erleben?
  Dann bewirb dich JETZT – PKW + LKW Führerschein sind Pflicht!`;
 }

    return `
Das MD öffnet die spontane mündliche Bewerbungsphase! 
 Wenn du Lust auf spannende medizinische Szenarien hast, dann komm morgen gern vorbei und werde teil des Los Santos Medical Department.
 Führerscheinpflicht: PKW & LKW.`;
}

async function sendJobAnnounceReminder() {
    if (!JOB_ANNOUNCE_CHANNEL_ID) {
        console.log("JOB_ANNOUNCE_CHANNEL_ID fehlt");
        return;
    }

    const channel = await botClient.channels.fetch(JOB_ANNOUNCE_CHANNEL_ID).catch(() => null);

    if (!channel) {
        console.log("Jobannounce Reminder Channel nicht gefunden");
        return;
    }

    const announceText = getJobAnnounceText();

    await channel.send({
        content: JOB_ANNOUNCE_PING_ROLE_ID ? `<@&${JOB_ANNOUNCE_PING_ROLE_ID}>` : "",
        embeds: [
            new EmbedBuilder()
                .setColor(0xef233c)
                .setTitle("📢 ANNOUNCE ERINNERUNG")
                .setDescription(
                    "Bitte vergesst nicht eure Werbung auf **LateNightV** zu schalten.\n\n" +
                    "```text\nF8 → /jobannounce → Text einfügen\n```\n" +
                    "Werbung ist alle **30 Minuten** erlaubt.\n\n" +
                    "**Text zum Kopieren:**\n" +
                    "```text\n" + announceText + "\n```"
                )
                .setFooter({ text: "LSMD Announce Reminder" })
                .setTimestamp()
        ],
        allowedMentions: {
    parse: [],
    roles: JOB_ANNOUNCE_PING_ROLE_ID
        ? [JOB_ANNOUNCE_PING_ROLE_ID]
        : []
}
    });

    console.log("Jobannounce Reminder gesendet");
}

function startJobAnnounceReminderWatcher() {
    console.log("Jobannounce Reminder Watcher gestartet");

    // Sofort nach Bot-Start einmal senden
    setTimeout(async () => {
        try {
            const berlin = getBerlinParts(new Date());

            console.log("Jobannounce Sofort-Check:", `${berlin.hour}:${berlin.minute}`);

            if (berlin.hour >= 14 && berlin.hour <= 23) {
                await sendJobAnnounceReminder();
            } else {
                console.log("Jobannounce Sofort übersprungen: außerhalb der Zeit");
            }
        } catch (err) {
            console.error("Jobannounce Sofort-Reminder Fehler:", err);
        }
    }, 10 * 1000);

    // Danach alle 60 Minuten senden
    setInterval(async () => {
        try {
            const berlin = getBerlinParts(new Date());

            console.log("Jobannounce 60-Minuten-Check:", `${berlin.hour}:${berlin.minute}`);

            if (berlin.hour < 14 || berlin.hour > 23) {
                console.log("Jobannounce übersprungen: außerhalb der Zeit");
                return;
            }

            await sendJobAnnounceReminder();
        } catch (err) {
            console.error("Jobannounce Reminder Fehler:", err);
        }
    }, 60 * 60 * 1000);
}

async function sendRegelwerkWebhook() {
    if (!process.env.REGELWERK_WEBHOOK_URL) {
        console.log("REGELWERK_WEBHOOK_URL fehlt");
        return false;
    }

    const embed = {
        color: 0xef233c,
        title: "📘 LSMD Regelwerk ist online",
        description:
            "Das interne **Prakti/Sani Regelwerk** befindet sich ab sofort direkt auf unserer Website.\n\n" +
            "**Dort findet ihr alle wichtigen Regeln zu:**\n" +
            "• Allgemeinem Verhalten\n" +
            "• Ausbildungen & Prüfungen\n" +
            "• Eintragungen & Bestätigungen\n" +
            "• Wochenziel & Punkte\n" +
            "• Dienstkleidung\n\n" +
            "Bitte lest euch das Regelwerk sorgfältig durch und haltet euch an die Vorgaben.\n\n" +
            "🔗 **Regelwerk öffnen:**\n" +
            "https://prakti-sani-website-punktesystem-lsmd.up.railway.app/regelwerk",
        footer: {
            text: "Made by Prof. Dr. Karim Tranquile"
        },
        timestamp: new Date().toISOString()
    };

    const response = await fetch(process.env.REGELWERK_WEBHOOK_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: "LSMD Regelwerk",
            avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",
            content: "",
            embeds: [embed],
            allowed_mentions: {
                parse: []
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Regelwerk Webhook Fehler:", response.status, errorText);
        return false;
    }

    console.log("Regelwerk Embed gesendet");
    return true;
}

async function sendDokumenteWebhook() {
    if (!DOKUMENTE_WEBHOOK_URL) {
        console.log("DOKUMENTE_WEBHOOK_URL fehlt");
        return false;
    }

    const embed = {
        color: 0x06b6d4,
        author: {
            name: "LSMD | Therapeuten-Abteilung",
            icon_url: LSMD_LOGO_URL
        },
        title: "🧠  Therapeuten-Dokumentenzentrale",
        description:
            "```ansi\n\u001b[1;36mLSMD THERAPEUTEN-SYSTEM\u001b[0m\n```\n" +
            "**Zentrale Übersicht für Sprechstunden, Dokumentation, Atteste und interne Leitungskontrolle.**\n\n" +
            "Alle wichtigen Dokumente sind hier gesammelt. Bitte nutzt ausschließlich diese offiziellen Links, damit alles sauber und aktuell bleibt.\n\n" +
            "━━━━━━━━━━━━━━━━━━━━",

        fields: [
            {
                name: "📊  Mastersheets & Übersichten",
                value:
                    ">>> **Therapeuten Mastersheet**\n" +
                    "Zentrale Übersicht für Patienten, Sitzungen, Atteste und Dokumentationen.\n" +
                    "🔗 [Mastersheet öffnen](https://docs.google.com/spreadsheets/d/1DDszXZ2Xk5rrFsmBPXsABKPipMX7CXNxY48MyP4B6lU/edit?usp=sharing)\n\n" +

                    "**Leitung Mastersheet Therapeuten**\n" +
                    "Interne Übersicht für Kontrolle, Verwaltung und Leitungsentscheidungen.\n" +
                    "🔗 [Leitungsübersicht öffnen](https://docs.google.com/spreadsheets/d/122mGv9zHHAmNCmR24-moQ_lGa5d3XW3n291pLAb8FLw/edit?usp=sharing)",
                inline: false
            },
            {
                name: "📝  Formulare & Sprechstunden",
                value:
                    ">>> **Therapeutische Sprechstunde**\n" +
                    "Formular für Gespräche, Sitzungen und interne therapeutische Dokumentationen.\n" +
                    "🔗 [Formular öffnen](https://docs.google.com/forms/d/e/1FAIpQLScB9T50A2LZkOtOhykfemftksW45lliWjakoGiyLQzOQSUvZg/viewform?usp=sharing&ouid=101346137102031307272)",
                inline: false
            },
            {
                name: "📘  Leitfäden & Einweisung",
                value:
                    ">>> **Therapeuten Leitfaden**\n" +
                    "Abläufe, Gesprächsführung, Verhalten und Dokumentationsregeln.\n" +
                    "🔗 [Leitfaden öffnen](https://docs.google.com/document/d/1srYmLkZfw4ADLdVyM0E9r9cSHa4u8whlfhU3zc4T-5A/edit?tab=t.0)\n\n" +

                    "**Leitung Therapeuten Einweisung**\n" +
                    "Einweisung für Leitung, neue Therapeuten und strukturierte Freigaben.\n" +
                    "🔗 [Einweisung öffnen](https://docs.google.com/document/d/1tlvdjuPJVBRG_StopSjuNNLPAKm4RxSvawrzdeajMHY/edit?tab=t.0)",
                inline: false
            },
            {
                name: "⚠️  Wichtige Hinweise",
                value:
                    "```diff\n" +
                    "+ Nur offizielle Dokumente verwenden\n" +
                    "+ Sachlich, kurz und nachvollziehbar dokumentieren\n" +
                    "- Keine unnötigen privaten Details eintragen\n" +
                    "- Keine veralteten Dokumente benutzen\n" +
                    "```",
                inline: false
            },
            {
                name: "🔄  Aktualisierung",
                value: `<t:${Math.floor(Date.now() / 1000)}:f>`,
                inline: true
            },
            {
                name: "🔐  Zugriff",
                value: "Nur intern für berechtigte Mitglieder",
                inline: true
            }
        ],
        footer: {
            text: "LSMD Therapeuten-System • Dokumentenverwaltung"
        },
        timestamp: new Date().toISOString()
    };

    const response = await fetch(DOKUMENTE_WEBHOOK_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: "LSMD Therapeuten-System",
            avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",
            content: "",
            embeds: [embed],
            allowed_mentions: {
                parse: []
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Dokumente Webhook Fehler:", response.status, errorText);
        return false;
    }

    console.log("Therapeuten Dokumentenübersicht als modernes Einzel-Embed gesendet");
    return true;
}

async function sendProfessorenDokumenteWebhook() {
    if (!PROFESSOREN_DOKUMENTE_WEBHOOK_URL) {
        console.log("PROFESSOREN_DOKUMENTE_WEBHOOK_URL fehlt");
        return false;
    }

    const embed = {
        color: 0x8b5cf6,
        author: {
            name: "LSMD | Professoren-Abteilung",
            icon_url: "https://cdn.discordapp.com/embed/avatars/0.png"
        },
        title: "🎓 Professoren-Dokumentenzentrale",
        description:
            "```ansi\n\u001b[1;35mLSMD PROFESSOREN-SYSTEM\u001b[0m\n```\n" +
            "**Zentrale Übersicht für Professoren, Schüler, Logs, Punkte und interne Leitungskontrolle.**\n\n" +
            "Alle wichtigen Dokumente der Professoren-Abteilung sind hier gesammelt. Bitte nutzt ausschließlich diese offiziellen Links, damit Schüler, Logs und Punkte sauber nachvollziehbar bleiben.\n\n" +
            "━━━━━━━━━━━━━━━━━━━━",

        fields: [
            {
                name: "📊  Mastersheet & Übersicht",
                value:
                    ">>> **Professoren Mastersheet**\n" +
                    "Zentrale Übersicht für Professoren, Schülerplätze, freie Plätze, Punkte und Status.\n" +
                    "🔗 [Mastersheet öffnen](https://docs.google.com/spreadsheets/d/1n9qplQUnJ1CkfoweVi7HJcwm1AiXmAl1r8p-mkB_7OI/edit?usp=sharing)",
                inline: false
            },
            {
                name: "📘  Leitfaden der Professoren-Abteilung",
                value:
                    ">>> **Interner Professoren-Leitfaden**\n" +
                    "Regeln, Abläufe, Schülerbetreuung, Punktesystem, Logs und Zuständigkeiten.\n" +
                    "🔗 [Leitfaden öffnen](https://docs.google.com/document/d/1gVYgUcxbvGVAt0ImQJIHCIvD2ofGnJyWiNr1OUGxWw8/edit?usp=sharing)",
                inline: false
            },
            {
                name: "🧑‍🎓  Schüler-System",
                value:
                    ">>> **Schüler-Anmeldung / Schülerliste**\n" +
                    "Übersicht für Schüler, freie Plätze und Professoren-Zuweisung.\n" +
                    "🔗 [Schülerübersicht öffnen](https://discord.com/channels/777099974265667585/1151226981195730954)",
                inline: false
            },
            {
                name: "📝  Logs & Nachweise",
                value:
                    ">>> **Professoren Logs**\n" +
                    "Vorlage und Übersicht für Schüler hinzufügen/entfernen, bestandene Prüfungen, Testphasen, Weiterbildungen und Upranks.\n" +
                    "🔗 [Logs öffnen](https://discord.com/channels/1461093816206623004/1513462215796326450)",
                inline: false
         
            },
            {
                name: "⚠️  Wichtige Hinweise",
                value:
                    "```diff\n" +
                    "+ Logs müssen sachlich und nachvollziehbar sein\n" +
                    "+ Schüler, Professor, Datum und Status immer angeben\n" +
                    "+ Punkte werden nur bei gültigen Logs gewertet\n" +
                    "- Keine unvollständigen oder falschen Einträge\n" +
                    "- Keine veralteten Dokumente benutzen\n" +
                    "```",
                inline: false
            },
            {
                name: "🔄  Aktualisierung",
                value: `<t:${Math.floor(Date.now() / 1000)}:f>`,
                inline: true
            },
            {
                name: "🔐  Zugriff",
                value: "Nur intern für Professoren / Leitung",
                inline: true
            }
        ],
        footer: {
            text: "LSMD Professoren-System • Dokumentenverwaltung"
        },
        timestamp: new Date().toISOString()
    };

    const response = await fetch(PROFESSOREN_DOKUMENTE_WEBHOOK_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: "LSMD Professoren-System",
            avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",
            content: "",
            embeds: [embed],
            allowed_mentions: {
                parse: []
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Professoren Dokumente Webhook Fehler:", response.status, errorText);
        return false;
    }

    console.log("Professoren Dokumentenübersicht als modernes Einzel-Embed gesendet");
    return true;
}

async function sendProfessorenSchuelerSystemPanel() {
    if (!PROFESSOREN_SCHUELER_SYSTEM_CHANNEL_ID) {
        console.log("PROFESSOREN_SCHUELER_SYSTEM_CHANNEL_ID fehlt");
        return;
    }

    const channel = await botClient.channels.fetch(PROFESSOREN_SCHUELER_SYSTEM_CHANNEL_ID).catch(() => null);

    if (!channel) {
        console.log("Professoren Schüler-System Channel nicht gefunden");
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle("🎓 LSMD Professoren | Schüler-System")
        .setDescription(
            "**Hier tragen Professoren ihre Schüler-Logs ein.**\n\n" +
            "Der Bot erstellt automatisch einen Log und erhöht die **Prof-Punkte** im Professoren-Mastersheet.\n\n" +
            "**Ablauf:**\n" +
            "1. Schüler ist im Haupt-MD Discord eingetragen.\n" +
            "2. Professor betreut Prüfung / Weiterbildung / Testphase.\n" +
            "3. Professor klickt unten auf den Button.\n" +
            "4. Log ausfüllen.\n" +
            "5. Punkte werden im Mastersheet aktualisiert."
        )
        .addFields(
            {
                name: "📌 Wichtig",
                value: "Die Professor-DN muss genau so eingetragen werden, wie sie im Mastersheet steht.",
                inline: false
            },
            {
                name: "🏆 Punkte-System",
                value:
                    "**Prüfung / Weiterbildung / Testphase bestanden** → Punkte eintragen\n" +
                    "**100 Punkte** = Grundlage für Anerkennung des Professoren-Titels.",
                inline: false
            }
        )
        .setFooter({ text: "LSMD Professoren-Abteilung | Schüler-System" })
        .setTimestamp();

    const professorRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
        .setCustomId("prof_professor_select")
        .setPlaceholder("Professor auswählen")
        .setMinValues(1)
        .setMaxValues(1)
);



const rankRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
        .setCustomId("prof_rank_select")
        .setPlaceholder("Weiterbildung / Rang auswählen")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
    {
        label: "Sanitäter → Allgemeinmediziner",
        value: "Sanitäter → Allgemeinmediziner",
        emoji: "🚑"
    },
    {
        label: "Allgemeinmediziner → Facharzt",
        value: "Allgemeinmediziner → Facharzt",
        emoji: "🩺"
    },
    {
        label: "Facharzt → Notarzt",
        value: "Facharzt → Notarzt",
        emoji: "🚨"
    },
    {
        label: "Notarzt → Arzt",
        value: "Notarzt → Arzt",
        emoji: "🏥"
    },
    {
        label: "Prakti-Sani Testphase bestanden",
        value: "Prakti-Sani Testphase bestanden",
        emoji: "📘"
    },
    {
        label: "Overwatch Testphase bestanden",
        value: "Overwatch Testphase bestanden",
        emoji: "👁️"
    },
    {
        label: "Therapeut Weiterbildung bestanden",
        value: "Therapeut Weiterbildung bestanden",
        emoji: "🧠"
    },
    {
        label: "Professor",
        value: "Professor",
        emoji: "🎓"
    },
    {
        label: "Assistenzarzt Testphase bestanden",
        value: "Assistenzarzt Testphase bestanden",
        emoji: "⚕️"
    },
    {
        label: "Personalabteilung Testphase bestanden",
        value: "Personalabteilung Testphase bestanden",
        emoji: "📋"
    },
    {
        label: "Oberarzt Testphase bestanden",
        value: "Oberarzt Testphase bestanden",
        emoji: "🏥"
    },
    {
        label: "Untere Leitung",
        value: "Untere Leitung",
        emoji: "🔰"
    },
    {
        label: "Stv. Leitung",
        value: "Stv. Leitung",
        emoji: "⚜️"
    },
    {
        label: "Leitung",
        value: "Leitung",
        emoji: "👑"
    }
)
);

const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
        .setCustomId("prof_log_create")
        .setLabel("Schüler-Log eintragen")
        .setEmoji("📝")
        .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
        .setCustomId("prof_points_show")
        .setLabel("Punkte anschauen")
        .setEmoji("📊")
        .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
        .setCustomId("prof_points_edit")
        .setLabel("Punkte bearbeiten")
        .setEmoji("✏️")
        .setStyle(ButtonStyle.Secondary)
);

const buttonRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
        .setCustomId("prof_points_add")
        .setLabel("Punkte manuell vergeben")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
        .setCustomId("prof_points_remove")
        .setLabel("Punkte manuell entfernen")
        .setEmoji("➖")
        .setStyle(ButtonStyle.Danger)
);

    const payload = {
        embeds: [embed],
        components: [professorRow, rankRow, buttonRow, buttonRow2],
        allowedMentions: {
            parse: []
        }
    };

    if (PROFESSOREN_SCHUELER_SYSTEM_MESSAGE_ID) {
        try {
            const message = await channel.messages.fetch(PROFESSOREN_SCHUELER_SYSTEM_MESSAGE_ID);

            await message.edit(payload);

            console.log("Professoren Schüler-System Panel aktualisiert");
            return;
        } catch (err) {
            console.error("PROFESSOREN_SCHUELER_SYSTEM_MESSAGE_ID falsch oder Nachricht gelöscht:", err);
            return;
        }
    }

    const message = await channel.send(payload);

    console.log("PROFESSOREN_SCHUELER_SYSTEM_MESSAGE_ID bitte in Railway eintragen:", message.id);
}

async function sendAbmeldungPanel() {
    if (!process.env.ABMELDUNG_CHANNEL_ID) {
        console.log("ABMELDUNG_CHANNEL_ID fehlt");
        return;
    }

    const channel = await botClient.channels.fetch(process.env.ABMELDUNG_CHANNEL_ID);

    if (!channel) {
        console.log("Abmeldung Channel nicht gefunden");
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle("🚑 LSMD Abmeldungssystem")
        .setDescription(
            "**Willkommen im Abmeldungsbereich des LSMD.**\n\n" +
            "Nutze den Button unten, um dich offiziell für einen Zeitraum abzumelden.\n\n" +
            "**Bitte beachte:**\n" +
            "• Abmeldungen bitte **erst ab 3 Tagen** eintragen\n" +
            "• Falsche oder unvollständige Angaben können abgelehnt werden"
        )
        .addFields(
            {
                name: "📋 Benötigte Angaben",
                value:
                    "**Name**\n" +
                    "**Dienstnummer**\n" +
                    "**Zeitraum**\n" +
                    "**Grund**",
                inline: false
            }
        )
        .setFooter({ text: "LSMD Abmeldungssystem • Automatische Vorlage" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("abmeldung_open_modal")
            .setLabel("Abmeldung einreichen")
            .setEmoji("📨")
            .setStyle(ButtonStyle.Primary)
    );

    await channel.send({
        embeds: [embed],
        components: [row],
        allowedMentions: {
            parse: []
        }
    });

    console.log("Abmeldungs-Panel gesendet");
}

function getBewerbungVoteStats(request) {
    const votes = Object.values(request.votes || {});

    const accept = votes.filter(vote => vote === "accept").length;
    const deny = votes.filter(vote => vote === "deny").length;

    return { accept, deny };
}

function buildBewerbungEmbed(request) {
    const stats = getBewerbungVoteStats(request);

    let statusText = "🟡 **Abstimmung läuft**";
    let color = 0x00b7ff;

    if (request.status === "angenommen") {
        statusText = "🟢 **Angenommen**";
        color = 0x22c55e;
    }

    if (request.status === "abgelehnt") {
        statusText = "🔴 **Abgelehnt**";
        color = 0xef233c;
    }

    const voteLines = Object.entries(request.votes || {}).length
        ? Object.entries(request.votes)
            .map(([userId, vote]) => {
                const emoji = vote === "accept" ? "✅" : "❌";
                const text = vote === "accept" ? "Dafür" : "Dagegen";
                return `${emoji} <@${userId}> — **${text}**`;
            })
            .join("\n")
        : "Noch keine Stimmen abgegeben.";

    const fields = [
        {
            name: "👤 Bewerber",
            value:
                `**Name / DN:** ${request.nameDn}\n` +
                `**Discord / Steam:** ${request.discordSteam}`,
            inline: false
        },
        {
            name: "🎓 Position",
            value: `**${request.position}**`,
            inline: true
        },
        {
            name: "📌 Status",
            value: statusText,
            inline: true
        },
        {
            name: "🗳️ Abstimmung",
            value:
                `✅ **Dafür:** ${stats.accept}\n` +
                `❌ **Dagegen:** ${stats.deny}\n` +
                `🎯 **Benötigt:** ${BEWERBUNG_REQUIRED_VOTES} gleiche Stimmen`,
            inline: false
        },
        {
            name: "📄 Bewerbungsdokument",
            value: request.documentUrl
                ? `[Dokument öffnen](${request.documentUrl})`
                : "Kein Dokument angegeben.",
            inline: false
        },
        {
            name: "📝 Zusammenfassung",
            value: request.summary || "Keine Zusammenfassung angegeben.",
            inline: false
        },
        {
            name: "👥 Abgestimmt",
            value: voteLines,
            inline: false
        }
    ];

    if (request.decidedBy) {
        fields.push({
            name: "🔒 Entscheidung",
            value: `Entschieden durch <@${request.decidedBy}>`,
            inline: false
        });
    }

    return new EmbedBuilder()
        .setColor(color)
        .setAuthor({
            name: "LSMD Bewerbungs-System",
            iconURL: "https://cdn.discordapp.com/embed/avatars/0.png"
        })
        .setTitle("🚑 Neue Bewerbung eingereicht")
        .setDescription(
            "**Eine neue Bewerbung wartet auf die Abstimmung der Leitung.**\n\n" +
            "Jede berechtigte Leitungsperson kann eine Stimme abgeben oder ändern."
        )
        .addFields(fields)
        .setFooter({ text: `LSMD Bewerbungs-System • Bewerbung #${request.id}` })
        .setTimestamp();
}

function buildBewerbungComponents(request) {
    const isClosed = request.status !== "offen";

    const buttons = [
        new ButtonBuilder()
            .setCustomId(`bewerbung_vote_accept_${request.id}`)
            .setLabel("Dafür stimmen")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success)
            .setDisabled(isClosed),

        new ButtonBuilder()
            .setCustomId(`bewerbung_vote_deny_${request.id}`)
            .setLabel("Dagegen stimmen")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(isClosed)
    ];

    if (request.documentUrl) {
        buttons.push(
            new ButtonBuilder()
                .setLabel("Dokument öffnen")
                .setEmoji("📄")
                .setStyle(ButtonStyle.Link)
                .setURL(request.documentUrl)
        );
    }

    return [
        new ActionRowBuilder().addComponents(buttons)
    ];
}

function buildBewerbungPanelComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("bewerbung_open_modal")
                .setLabel("Bewerbung eintragen")
                .setEmoji("🚑")
                .setStyle(ButtonStyle.Primary)
        )
    ];
}

async function sendBewerbungsPanel() {
    if (!BEWERBUNG_CHANNEL_ID) {
        console.log("BEWERBUNG_CHANNEL_ID fehlt");
        return;
    }

    const channel = await botClient.channels.fetch(BEWERBUNG_CHANNEL_ID).catch(() => null);

    if (!channel) {
        console.log("Bewerbungs-Channel nicht gefunden");
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0x00b7ff)
        .setTitle("🚑 LSMD Bewerbungs-System")
        .setDescription(
            "**Privates Bewerbungs-System für die Leitung.**\n\n" +
            "Hier können Bewerbungen eingetragen und anschließend von der Leitung abgestimmt werden.\n\n" +
            "**Ablauf:**\n" +
            "1. Bewerbung eintragen\n" +
            "2. Dokument prüfen\n" +
            "3. Leitung stimmt ab\n" +
            "4. Ab genug Stimmen entscheidet das System automatisch"
        )
        .addFields(
            {
                name: "👥 Sichtbarkeit",
                value: "Nur Leitung sollte diesen Channel sehen.",
                inline: false
            },
            {
                name: "🗳️ Abstimmung",
                value: `Benötigt werden **${BEWERBUNG_REQUIRED_VOTES} gleiche Stimmen**.`,
                inline: false
            }
        )
        .setFooter({ text: "LSMD Bewerbungs-System • Leitung" })
        .setTimestamp();

    await channel.send({
        embeds: [embed],
        components: buildBewerbungPanelComponents(),
        allowedMentions: {
            parse: []
        }
    });

    console.log("Bewerbungs-Panel gesendet");
}

function getEmailTargetChannels(member) {
    const roles = member.roles?.cache;
    const targets = [];

    if (!roles) {
        return targets;
    }

    if (PRAKTI_SANI_ROLE_ID && roles.has(PRAKTI_SANI_ROLE_ID)) {
        targets.push({
            channelId: process.env.EMAIL_PRAKTI_SANI_CHANNEL_ID,
            department: "Prakti-Sani"
        });
    }

    if (process.env.ROLE_OVERWATCH && roles.has(process.env.ROLE_OVERWATCH)) {
        targets.push({
            channelId: process.env.EMAIL_OVERWATCH_CHANNEL_ID,
            department: "Overwatch"
        });
    }

    if (process.env.ROLE_OBERARZT && roles.has(process.env.ROLE_OBERARZT)) {
        targets.push({
            channelId: process.env.EMAIL_OBERARZT_CHANNEL_ID,
            department: "Oberarzt"
        });
    }

    if (process.env.ROLE_PROFESSOR && roles.has(process.env.ROLE_PROFESSOR)) {
        targets.push({
            channelId: process.env.EMAIL_PROFESSOREN_CHANNEL_ID,
            department: "Professoren"
        });
    }

    if (process.env.ROLE_THERAPEUTEN && roles.has(process.env.ROLE_THERAPEUTEN)) {
        targets.push({
            channelId: process.env.EMAIL_THERAPEUTEN_CHANNEL_ID,
            department: "Therapeuten"
        });
    }

    return targets.filter(target => target.channelId);
}

async function sendEmailPanel() {
    if (!process.env.EMAIL_PANEL_CHANNEL_ID) {
        console.log("EMAIL_PANEL_CHANNEL_ID fehlt");
        return false;
    }

    const channel = await botClient.channels.fetch(process.env.EMAIL_PANEL_CHANNEL_ID).catch(() => null);

    if (!channel) {
        console.log("E-Mail Panel Channel nicht gefunden");
        return false;
    }

    const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("📨 E-Mail-Erfassung")
    .setDescription(
        "**Mit dieser Funktion kannst du deine E-Mail-Adresse vertraulich und sicher übermitteln.**\n\n" +
        "Sie wird ausschließlich für interne Zwecke genutzt (z. B. Dokumenten-Zugriffe).\n\n" +
        "**Ablauf:**\n" +
        "Klicke auf den Knopf, um deine E-Mail-Adresse einzutragen.\n" +
        "Nach dem Absenden wird dein Eintrag automatisch im internen Log-System gespeichert."
    )
    .setThumbnail(LSMD_LOGO_URL)
    .setFooter({
        text: "Medical Department | LSMD – Made by Karim",
        iconURL: LSMD_LOGO_URL    
})
    .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("email_open_modal")
            .setLabel("E-Mail eintragen")
            .setEmoji("📨")
            .setStyle(ButtonStyle.Secondary)
    );

    await channel.send({
        embeds: [embed],
        components: [row],
        allowedMentions: {
            parse: []
        }
    });

    console.log("E-Mail-Erfassungs-Panel gesendet");
    return true;
}

async function sendAttestPanel() {
    if (!process.env.ATTEST_PANEL_CHANNEL_ID) {
        console.log("ATTEST_PANEL_CHANNEL_ID fehlt");
        return false;
    }

    const channel = await botClient.channels.fetch(process.env.ATTEST_PANEL_CHANNEL_ID).catch(() => null);

    if (!channel) {
        console.log("Attest Panel Channel nicht gefunden");
        return false;
    }

    const embed = new EmbedBuilder()
        .setColor(0x06b6d4)
        .setTitle("📄 LSMD Attest ausstellen")
        .setDescription(
            "**Hier können berechtigte Mitglieder ein Attest ausstellen.**\n\n" +
            "**Ablauf:**\n" +
            "1. Auf **Attest ausstellen** klicken\n" +
            "2. Name vom Patienten eintragen\n" +
            "3. Attest auswählen\n" +
            "4. Genehmigende Person auswählen\n" +
            "5. Das fertige Attest wird automatisch in den Ausgabe-Channel gesendet"
        )
        .addFields(
            {
                name: "📌 Hinweis",
                value: "Bitte nur vollständige und korrekt genehmigte Atteste ausstellen.",
                inline: false
            }
        )
        .setFooter({ text: "LSMD Therapeuten-Abteilung" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("attest_open_modal")
            .setLabel("Attest ausstellen")
            .setEmoji("📄")
            .setStyle(ButtonStyle.Primary)
    );

    await channel.send({
        embeds: [embed],
        components: [row],
        allowedMentions: {
            parse: []
        }
    });

    console.log("Attest-Panel gesendet");
    return true;
}

function normalizeOverwatchDate(dateValue) {
    if (!dateValue) {
        return null;
    }

    const parsed = new Date(dateValue);

    if (isNaN(parsed)) {
        return null;
    }

    parsed.setHours(0, 0, 0, 0);
    return parsed;
}

function getOverwatchDaysSince(dateValue) {
    const issuedDate = normalizeOverwatchDate(dateValue);

    if (!issuedDate) {
        return 0;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffMs = today.getTime() - issuedDate.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function getOverwatchDueDate(dateValue) {
    const issuedDate = normalizeOverwatchDate(dateValue);

    if (!issuedDate) {
        return null;
    }

    const dueDate = new Date(issuedDate);
    dueDate.setDate(dueDate.getDate() + OVERWATCH_RED_DAYS);

    return dueDate;
}

function getOverwatchStatus(dateValue) {
    const days = getOverwatchDaysSince(dateValue);

    if (days >= OVERWATCH_RED_DAYS) {
        return {
            key: "red",
            label: "Auffrischung nötig",
            emoji: "🔴",
            color: 0xef233c,
            days
        };
    }

    if (days >= OVERWATCH_YELLOW_DAYS) {
        return {
            key: "yellow",
            label: "Bald fällig",
            emoji: "🟡",
            color: 0xfacc15,
            days
        };
    }

    return {
        key: "green",
        label: "Gültig",
        emoji: "✅",
        color: 0x22c55e,
        days
    };
}

function formatOverwatchDate(dateValue) {
    const date = normalizeOverwatchDate(dateValue);

    if (!date) {
        return "-";
    }

    return date.toLocaleDateString("de-DE");
}

function formatTerminDateForDiscord(date, time) {
    if (!date) {
        return null;
    }

    const safeTime = time && time.trim() !== "" ? time : "00:00";
    const parsed = new Date(`${date}T${safeTime}:00`);

    if (isNaN(parsed)) {
        return null;
    }

    return Math.floor(parsed.getTime() / 1000);
}

async function sendAusbildungsterminDiscordEmbed(data) {
    try {
        if (!process.env.AUSBILDUNG_TERMINE_CHANNEL_ID) {
            console.log("AUSBILDUNG_TERMINE_CHANNEL_ID fehlt");
            return false;
        }

        const channel = await botClient.channels.fetch(process.env.AUSBILDUNG_TERMINE_CHANNEL_ID).catch(() => null);

        if (!channel) {
            console.log("Ausbildungstermine Channel nicht gefunden");
            return false;
        }

        const isSani = data.examType === "Sanitaeter-Pruefung";
        const typeLabel = isSani ? "Sanitäter-Prüfung" : "Darf alleine fahren";
        const typeEmoji = isSani ? "🚑" : "🚗";
        const embedColor = isSani ? 0x22c55e : 0x2563eb;

        const timestamp = formatTerminDateForDiscord(data.date, data.time);

        const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setAuthor({
        name: "LSMD Ausbildungssystem",
        iconURL: AUSBILDUNG_LOGO_URL
    })
    .setTitle(`${typeEmoji} Neuer Ausbildungstermin`)
    .setThumbnail(AUSBILDUNG_LOGO_URL)
    .setDescription(
        "Ein neuer Ausbildungstermin wurde auf der **LSMD Website** eingetragen.\n\n" +
        "Dieser Eintrag dient nur zur Übersicht, damit das Team und die Leitung direkt Bescheid wissen."
    )
            .addFields(
                {
                    name: "👤 Teilnehmer",
                    value: `**${data.name || "Unbekannt"}**`,
                    inline: true
                },
                {
                    name: "📚 Art",
                    value: `**${typeLabel}**`,
                    inline: true
                },
                {
                    name: "📅 Termin",
                    value: timestamp
                        ? `<t:${timestamp}:F>\n<t:${timestamp}:R>`
                        : `**${data.date || "-"}** um **${data.time || "--:--"}**`,
                    inline: false
                },
                {
                    name: "👨‍🏫 Ausbilder / Prüfer",
                    value: `**${data.examiner || "Nicht eingetragen"}**`,
                    inline: true
                },
                {
                    name: "✍️ Eingetragen von",
                    value: data.createdById ? `<@${data.createdById}>` : `**${data.createdByName || "Unbekannt"}**`,
                    inline: true
                },
                {
                    name: "📌 Status",
                    value: "**Eingetragen**",
                    inline: true
                }
            )
            .setFooter({
                text: "LSMD Prakti-Sani • Ausbildungstermine",
                iconURL: LSMD_LOGO_URL
            })
            .setTimestamp();

        if (data.notes && data.notes.trim() !== "") {
            embed.addFields({
                name: "📝 Notiz",
                value: data.notes.slice(0, 1000),
                inline: false
            });
        }

        await channel.send({
            embeds: [embed],
            allowedMentions: {
                parse: []
            }
        });

        console.log("Ausbildungstermin Übersicht gesendet");
        return true;
    } catch (err) {
        console.error("Fehler beim Senden vom Ausbildungstermin Embed:", err);
        return false;
    }
}

function getOverwatchReminderDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

async function sendOverwatchRefreshReminder(license) {
    try {
        if (!OVERWATCH_REMINDER_CHANNEL_ID) {
            console.log("OVERWATCH_REMINDER_CHANNEL_ID fehlt");
            return false;
        }

        const channel = await botClient.channels.fetch(OVERWATCH_REMINDER_CHANNEL_ID).catch(() => null);

        if (!channel) {
            console.log("Overwatch Auffrischung Channel nicht gefunden");
            return false;
        }

        const status = getOverwatchStatus(license.issuedAt);
        const dueDate = getOverwatchDueDate(license.issuedAt);

        const embed = new EmbedBuilder()
            .setColor(0xef233c)
            .setTitle("🔴 Overwatch Auffrischung fällig")
            .setDescription(
                `**${license.dn} | ${license.name}** benötigt eine Auffrischungsprüfung.\n\n` +
                "Die Lizenz ist abgelaufen und muss durch die Overwatch-Abteilung geprüft werden."
            )
            .addFields(
                {
                    name: "👤 Mitglied",
                    value: `**${license.dn} | ${license.name}**`,
                    inline: false
                },
                {
                    name: "👁️ Lizenz",
                    value: `**${license.licenseType}**`,
                    inline: true
                },
                {
                    name: "📅 Lizenz seit",
                    value: `**${formatOverwatchDate(license.issuedAt)}**`,
                    inline: true
                },
                {
                    name: "⏰ Fällig seit",
                    value: `**${formatOverwatchDate(dueDate)}**`,
                    inline: true
                },
                {
                    name: "📌 Status",
                    value: `${status.emoji} **${status.label}**\n${status.days} Tag(e) alt`,
                    inline: true
                },
                {
                    name: "👨‍🏫 Letzter Prüfer",
                    value: `**${license.examiner || "-"}**`,
                    inline: true
                }
            )
            .setFooter({
                text: "LSMD Overwatch-System • Auffrischung",
                iconURL: LSMD_LOGO_URL
            })
            .setTimestamp();

        if (license.notes) {
            embed.addFields({
                name: "📝 Notiz",
                value: String(license.notes).slice(0, 1000),
                inline: false
            });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`overwatch_refresh_done_${license._id.toString()}`)
                .setLabel("Auffrischungsprüfung gemacht")
                .setEmoji("✅")
                .setStyle(ButtonStyle.Success)
        );

        await channel.send({
            embeds: [embed],
            components: [row],
            allowedMentions: {
                parse: []
            }
        });

        console.log("Overwatch Auffrischung Reminder gesendet:", license.dn, license.name);
        return true;
    } catch (err) {
        console.error("Overwatch Reminder Fehler:", err);
        return false;
    }
}

async function checkOverwatchRefreshReminders() {
    try {
        if (!overwatchLicensesCollection) {
            return;
        }

        const todayKey = getOverwatchReminderDayKey();

        const licenses = await overwatchLicensesCollection
            .find({})
            .toArray();

        for (const license of licenses) {
            const status = getOverwatchStatus(license.issuedAt);

            if (status.key !== "red") {
                continue;
            }

            if (license.lastReminderDayKey === todayKey) {
                continue;
            }

            const sent = await sendOverwatchRefreshReminder(license);

            if (sent) {
                await overwatchLicensesCollection.updateOne(
                    { _id: license._id },
                    {
                        $set: {
                            lastReminderAt: new Date(),
                            lastReminderDayKey: todayKey,
                            lastReminderLevel: "red",
                            updatedAt: new Date()
                        }
                    }
                );
            }
        }
    } catch (err) {
        console.error("Overwatch Reminder Check Fehler:", err);
    }
}

function startOverwatchReminderWatcher() {
    console.log("Overwatch Reminder Watcher gestartet");

    setTimeout(async () => {
        await checkOverwatchRefreshReminders();
    }, 15 * 1000);

    setInterval(async () => {
        await checkOverwatchRefreshReminders();
    }, 60 * 60 * 1000);
}

async function sendOverwatchPanel() {
    if (!OVERWATCH_PANEL_CHANNEL_ID) {
        console.log("OVERWATCH_PANEL_CHANNEL_ID fehlt");
        return false;
    }

    const channel = await botClient.channels.fetch(OVERWATCH_PANEL_CHANNEL_ID).catch(() => null);

    if (!channel) {
        console.log("Overwatch Panel Channel nicht gefunden");
        return false;
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("👁️ LSMD Overwatch Lizenz-System")
        .setDescription(
            "**Hier verwaltet die Overwatch-Abteilung ihre Lizenzen und Auffrischungen.**\n\n" +
            "Alle Einträge werden automatisch gespeichert und erscheinen später auch auf der Website.\n\n" +
            "**Status-System:**\n" +
            "✅ **0–11 Tage:** Gültig\n" +
            "🟡 **ab 12 Tagen:** Bald fällig\n" +
            "🔴 **ab 25 Tagen:** Auffrischung nötig\n\n" +
            "Wähle unten eine Aktion aus."
        )
        .addFields(
            {
                name: "📋 Lizenzen",
                value: "Overwatch\nOverwatch+\nOsprey",
                inline: true
            },
            {
                name: "📌 Hinweis",
                value: "Bitte nur echte und geprüfte Lizenzen eintragen.",
                inline: true
            }
        )
        .setFooter({
            text: "LSMD Overwatch-System • Made by Prof. Dr. Karim Tranquile",
            iconURL: LSMD_LOGO_URL
        })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("overwatch_license_start")
            .setLabel("Lizenz eintragen")
            .setEmoji("➕")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("overwatch_due_show")
            .setLabel("Fällige anzeigen")
            .setEmoji("📋")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("overwatch_refresh_start")
            .setLabel("Auffrischung eintragen")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success)
    );

    await channel.send({
        embeds: [embed],
        components: [row],
        allowedMentions: {
            parse: []
        }
    });

    console.log("Overwatch Panel gesendet");
    return true;
}

async function sendSpontanePruefungenPanel() {
    if (!process.env.SPONTANE_PRUEFUNGEN_CHANNEL_ID) {
        console.log("SPONTANE_PRUEFUNGEN_CHANNEL_ID fehlt");
        return;
    }

    const channel = await botClient.channels.fetch(process.env.SPONTANE_PRUEFUNGEN_CHANNEL_ID);

    if (!channel) {
        console.log("Spontane Prüfungen Channel nicht gefunden");
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0x2563eb)
        .setTitle("🚑 Spontane Prüfung eintragen")
        .setDescription(
            "Wähle zuerst die Prüfungsart aus.\n\n" +
            "Klicke danach auf **Antrag erstellen** und trage im Fenster die **DN** und den **Namen** des Prüflings ein.\n\n" +
            "Anschließend wartet der Antrag auf die Entscheidung der Leitung."
        )
        .addFields(
            {
                name: "Schritt 1",
                value: "Prüfungsart auswählen.",
                inline: true
            },
            {
                name: "Schritt 2",
                value: "Auf **Antrag erstellen** klicken und DN + Name eintragen.",
                inline: true
            },
            {
    name: "📌 Status",
    value: "⏳ Wartet auf Entscheidung der Leitung",
    inline: false
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
            data?.actorName ||
            data?.name ||
            "Unbekannt";

        let title = "Dashboard-Aktion";
        let description = `${actorName} hat eine Aktion im LSMD Dashboard ausgeführt.`;
        let color = 0x2563eb;
        let emoji = "📌";

        if (action === "Login") {
            title = "Login";
            description = `${actorName} hat sich im LSMD Dashboard eingeloggt.`;
            color = 0x22c55e;
            emoji = "🔐";
        }

        if (action === "Ausbildungstermin erstellt") {
            title = "Ausbildungstermin erstellt";
            description = `${actorName} hat einen neuen Ausbildungstermin eingetragen.`;
            color = 0x2563eb;
            emoji = "📅";
        }

        if (action === "Ausbildungstermin bearbeitet") {
            title = "Ausbildungstermin bearbeitet";
            description = `${actorName} hat einen Ausbildungstermin bearbeitet.`;
            color = 0xf59e0b;
            emoji = "✏️";
        }

        if (action === "Termin gelöscht" || action === "Termin geloescht") {
            title = "Ausbildungstermin gelöscht";
            description = `${actorName} hat einen Ausbildungstermin gelöscht.`;
            color = 0xef233c;
            emoji = "🗑️";
        }

        if (action === "Dokument hinzugefügt" || action === "Dokument hinzugefuegt") {
            title = "Dokument hinzugefügt";
            description = `${actorName} hat ein neues Dokument hinzugefügt.`;
            color = 0x22c55e;
            emoji = "📄";
        }

        if (action === "Dokument bearbeitet") {
            title = "Dokument bearbeitet";
            description = `${actorName} hat ein Dokument bearbeitet.`;
            color = 0xf59e0b;
            emoji = "📝";
        }

        if (action === "Dokument gelöscht" || action === "Dokument geloescht") {
            title = "Dokument gelöscht";
            description = `${actorName} hat ein Dokument gelöscht.`;
            color = 0xef233c;
            emoji = "🗑️";
        }

        if (
            action === "Punkte hinzugefügt" ||
            action === "Punkte hinzugefuegt" ||
            action === "Punkte entfernt" ||
            action === "Punkte gesetzt"
        ) {
            title = "Punkteverwaltung";
            description = `${actorName} hat Punkte im Dashboard geändert.`;
            color = 0xf59e0b;
            emoji = "⭐";
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
                name: "Ausbilder / Prüfer",
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
            name: "Ausgeführt von",
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

let teamListUpdateTimer = null;

let guildMembersFetchCacheTime = 0;
const GUILD_MEMBERS_FETCH_CACHE_TIME = 1000 * 60 * 5;

async function fetchGuildMembersSafe(guild) {
    if (Date.now() - guildMembersFetchCacheTime < GUILD_MEMBERS_FETCH_CACHE_TIME) {
        return;
    }

    console.log("Lade alle Discord Mitglieder sicher...");
    await guild.members.fetch();

    guildMembersFetchCacheTime = Date.now();
}

function scheduleTeamListUpdate() {
    clearTimeout(teamListUpdateTimer);

    teamListUpdateTimer = setTimeout(() => {
        updateTeamListMessage().catch((err) => {
            console.error("Teamliste konnte nicht aktualisiert werden:", err);
        });
    }, 2500);
}

function hasRole(member, roleId) {
    return roleId && member.roles.cache.has(roleId);
}

function memberLine(member) {
    return `<@${member.id}>`;
}

function sortMembers(members) {
    return [...members].sort((a, b) => {
        const nameA = a.displayName || a.user.username || "";
        const nameB = b.displayName || b.user.username || "";
        return nameA.localeCompare(nameB, "de");
    });
}

function buildRoleField(title, members) {
    const sorted = sortMembers(members || []);

    return {
        name: `${title} (${sorted.length})`,
        value: sorted.length > 0
            ? sorted.map(memberLine).join("\n").slice(0, 1000)
            : "—",
        inline: false
    };
}

async function updateTeamListMessage() {
    if (!process.env.TEAM_LIST_CHANNEL_ID) {
        console.log("TEAM_LIST_CHANNEL_ID fehlt");
        return;
    }

    const channel = await botClient.channels.fetch(process.env.TEAM_LIST_CHANNEL_ID);

    if (!channel) {
        console.log("Teamliste Channel nicht gefunden");
        return;
    }

    const guild = await botClient.guilds.fetch(process.env.DISCORD_GUILD_ID);

    await fetchGuildMembersSafe(guild);

    const allMembers = Array.from(guild.members.cache.values())
        .filter(member => !member.user.bot);

    const head = allMembers.filter(member => hasRole(member, process.env.ROLE_HEAD_PRAKTI_SANI));
    const leitung = allMembers.filter(member => hasRole(member, process.env.ROLE_LEITUNG));
    const stvLeitung = allMembers.filter(member => hasRole(member, process.env.ROLE_STV_LEITUNG));
    const untereLeitung = allMembers.filter(member => hasRole(member, process.env.ROLE_UNTERE_LEITUNG));
    const seniorAusbilder = allMembers.filter(member => hasRole(member, process.env.ROLE_SENIOR));
    const festeMitarbeiter = allMembers.filter(member => hasRole(member, process.env.ROLE_FESTES_MITGLIED));
    const testphase = allMembers.filter(member => hasRole(member, process.env.ROLE_TESTPHASE));
    const aushilfen = allMembers.filter(member => hasRole(member, process.env.ROLE_AUSHILFE));

    const groupedIds = new Set([
        ...head.map(m => m.id),
        ...leitung.map(m => m.id),
        ...stvLeitung.map(m => m.id),
        ...untereLeitung.map(m => m.id),
        ...seniorAusbilder.map(m => m.id),
        ...festeMitarbeiter.map(m => m.id),
        ...testphase.map(m => m.id),
        ...aushilfen.map(m => m.id)
    ]);

    const allTeamIds = groupedIds;

const embed = new EmbedBuilder()
    .setColor(0xef233c)
    .setTitle("🚑 LSMD Prakti-Sani Teamliste")
    .setDescription(
        "**Aktuelle Mitgliederübersicht der Abteilung**\n\n" +
        "Diese Liste wird automatisch aktualisiert und zeigt alle eingetragenen Teamrollen."
    )
    .addFields(
            {
                name: "📊 Übersicht",
                value:
                    `**Teammitglieder gesamt:** ${allTeamIds.size}\n` +
                    `**Letzte Aktualisierung:** <t:${Math.floor(Date.now() / 1000)}:R>`,
                inline: false
            },
            buildRoleField("👑 Head of Prakti-Sani", head),
            buildRoleField("🛡️ Prakti-Sani Leitung", leitung),
            buildRoleField("⚜️ Prakti-Sani Stv. Leitung", stvLeitung),
            buildRoleField("🔰 Prakti-Sani Untere Leitung", untereLeitung),
            buildRoleField("⭐ Prakti-Sani Sr. Ausbilder", seniorAusbilder),
            buildRoleField("✅ Prakti-Sani feste Mitarbeiter", festeMitarbeiter),
            buildRoleField("🧪 Prakti-Sani Testphase", testphase),
            buildRoleField("🤝 Prakti-Sani Aushilfen", aushilfen),
        )
        .setFooter({ text: "LSMD Ausbildungssystem • Automatische Teamliste" })
        .setTimestamp();

    if (process.env.TEAM_LIST_MESSAGE_ID) {
        try {
            const message = await channel.messages.fetch(process.env.TEAM_LIST_MESSAGE_ID);

            await message.edit({
                content: "",
                embeds: [embed],
                allowedMentions: {
                    parse: []
                }
            });

            console.log("Teamliste als Embed aktualisiert");
            return;
        } catch (err) {
    console.error("TEAM_LIST_MESSAGE_ID falsch oder Nachricht gelöscht:", err);
    return;
}
    }

    const message = await channel.send({
        content: "",
        embeds: [embed],
        allowedMentions: {
            parse: []
        }
    });

    console.log("TEAM_LIST_MESSAGE_ID bitte in Railway eintragen:", message.id);
}

async function updateCustomTeamListMessage(config) {
    if (!config.channelId) {
        console.log(`${config.logName} Channel-ID fehlt`);
        return;
    }

    const channel = await botClient.channels.fetch(config.channelId).catch(() => null);

    if (!channel) {
        console.log(`${config.logName} Channel nicht gefunden`);
        return;
    }

    const guild = await botClient.guilds.fetch(process.env.DISCORD_GUILD_ID);

    console.log(`Lade Mitglieder für ${config.logName}...`);
await fetchGuildMembersSafe(guild);

    const allMembers = Array.from(guild.members.cache.values())
        .filter(member => !member.user.bot);

    const groups = config.groups.map(group => ({
        title: group.title,
        members: allMembers.filter(member => hasRole(member, group.roleId))
    }));

    const groupedIds = new Set(
        groups.flatMap(group => group.members.map(member => member.id))
    );

    const embed = new EmbedBuilder()
        .setColor(config.color)
        .setTitle(config.title)
        .setDescription(
            "**Aktuelle Mitgliederübersicht der Abteilung**\n\n" +
            "Diese Liste wird automatisch aktualisiert und zeigt alle eingetragenen Teamrollen."
        )
        .addFields(
            {
                name: "📊 Übersicht",
                value:
                    `**Teammitglieder gesamt:** ${groupedIds.size}\n` +
                    `**Letzte Aktualisierung:** <t:${Math.floor(Date.now() / 1000)}:R>`,
                inline: false
            },
            ...groups.map(group => buildRoleField(group.title, group.members))
        )
        .setFooter({ text: `${config.footer} • Automatische Teamliste` })
        .setTimestamp();

    if (config.messageId) {
        try {
            const message = await channel.messages.fetch(config.messageId);

            await message.edit({
                content: "",
                embeds: [embed],
                allowedMentions: {
                    parse: []
                }
            });

            console.log(`${config.logName} Teamliste aktualisiert`);
            return;
        } catch (err) {
            console.error(`${config.logName} MESSAGE_ID falsch oder Nachricht gelöscht:`, err);
            return;
        }
    }

    const message = await channel.send({
        content: "",
        embeds: [embed],
        allowedMentions: {
            parse: []
        }
    });

    console.log(`${config.logName}_MESSAGE_ID bitte in Railway eintragen:`, message.id);
}

async function updateTherapeutenTeamListMessage() {
    await updateCustomTeamListMessage({
        logName: "THERAPEUTEN_TEAM_LIST",
        channelId: process.env.THERAPEUTEN_TEAM_LIST_CHANNEL_ID,
        messageId: process.env.THERAPEUTEN_TEAM_LIST_MESSAGE_ID,
        color: 0x06b6d4,
        title: "🧠 LSMD Therapeuten-Abteilung Teamliste",
        footer: "LSMD Therapeuten-System",
        groups: [
            {
                title: "👑 Leitung Therapeuten",
                roleId: process.env.ROLE_THERAPEUTEN_LEITUNG
            },
            {
                title: "⚜️ Stv. Leitung Therapeuten",
                roleId: process.env.ROLE_THERAPEUTEN_STV_LEITUNG
            },
            {
                title: "🧠 Therapeuten",
                roleId: process.env.ROLE_THERAPEUTEN
            }
        ]
    });
}

async function updateProfessorenTeamListMessage() {
    await updateCustomTeamListMessage({
        logName: "PROFESSOREN_TEAM_LIST",
        channelId: process.env.PROFESSOREN_TEAM_LIST_CHANNEL_ID,
        messageId: process.env.PROFESSOREN_TEAM_LIST_MESSAGE_ID,
        color: 0x8b5cf6,
        title: "🎓 LSMD Professoren-Abteilung Teamliste",
        footer: "LSMD Professoren-System",
        groups: [
            {
                title: "👑 Leitung Professoren",
                roleId: process.env.ROLE_PROFESSOREN_LEITUNG
            },
            {
                title: "⚜️ Stv. Leitung Professoren",
                roleId: process.env.ROLE_PROFESSOREN_STV_LEITUNG
            },
            {
                title: "🎓 Professoren",
                roleId: process.env.ROLE_PROFESSOR
            }
        ]
    });
}

botClient.once(Events.ClientReady, async () => {
    console.log("Discord Bot ist bereit");

    startJobAnnounceReminderWatcher();
    startOverwatchReminderWatcher();

    try {
        await updateTeamListMessage();
        await updateTherapeutenTeamListMessage();
        await updateProfessorenTeamListMessage();
        await sendProfessorenSchuelerSystemPanel();
    } catch (err) {
        console.error("Teamliste / Professoren Panel konnte beim Start nicht aktualisiert werden:", err);
    }
});

botClient.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
        const watchedRoles = [
            process.env.ROLE_HEAD_PRAKTI_SANI,
            process.env.ROLE_LEITUNG,
            process.env.ROLE_STV_LEITUNG,
            process.env.ROLE_UNTERE_LEITUNG,
            process.env.ROLE_SENIOR,
            process.env.ROLE_FESTES_MITGLIED,
            process.env.ROLE_TESTPHASE,
            process.env.ROLE_AUSHILFE
        ].filter(Boolean);

        const roleChanged = watchedRoles.some(roleId =>
            oldMember.roles.cache.has(roleId) !== newMember.roles.cache.has(roleId)
        );

        if (!roleChanged) {
            return;
        }

        scheduleTeamListUpdate();
    } catch (err) {
        console.error("Teamliste konnte nach Rollenänderung nicht geplant werden:", err);
    }
});

botClient.on(Events.GuildMemberAdd, async () => {
    scheduleTeamListUpdate();
});

botClient.on(Events.GuildMemberRemove, async () => {
    scheduleTeamListUpdate();
});

botClient.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (
    !interaction.isStringSelectMenu() &&
    !interaction.isUserSelectMenu() &&
    !interaction.isButton() &&
    !interaction.isModalSubmit()
) {
    return;
}

        if (
    !interaction.customId.startsWith("spontan_") &&
    !interaction.customId.startsWith("abmeldung_") &&
    !interaction.customId.startsWith("einstellung_bonus_") &&
    !interaction.customId.startsWith("bewerbung_") &&
    !interaction.customId.startsWith("prof_") &&
    !interaction.customId.startsWith("email_") &&
    !interaction.customId.startsWith("overwatch_") &&
    !interaction.customId.startsWith("attest_")
) {
    return;
}

// ===============================
// OVERWATCH LIZENZ SYSTEM
// ===============================
if (
    interaction.customId.startsWith("overwatch_") &&
    !canUseOverwatchDiscord(interaction)
) {
    return interaction.reply({
        content: "❌ Du hast keine Berechtigung für das Overwatch-System.",
        flags: MessageFlags.Ephemeral
    });
}


if (interaction.isButton() && interaction.customId === "overwatch_due_show") {
    const licensesRaw = await overwatchLicensesCollection
        .find({})
        .sort({ issuedAt: 1, createdAt: 1 })
        .toArray();

    const dueLicenses = licensesRaw
        .map((license) => {
            const status = getOverwatchStatus(license.issuedAt);
            const dueDate = getOverwatchDueDate(license.issuedAt);

            return {
                ...license,
                status,
                dueDate
            };
        })
        .filter((license) => license.status.key === "yellow" || license.status.key === "red")
        .sort((a, b) => {
            if (a.status.key === "red" && b.status.key !== "red") return -1;
            if (a.status.key !== "red" && b.status.key === "red") return 1;
            return b.status.days - a.status.days;
        });

    if (dueLicenses.length === 0) {
        return interaction.reply({
            content: "✅ Aktuell sind keine Overwatch-Lizenzen bald fällig oder überfällig.",
            flags: MessageFlags.Ephemeral
        });
    }

    const listText = dueLicenses
        .slice(0, 20)
        .map((license, index) => {
            return (
                `**${index + 1}. ${license.status.emoji} ${license.dn} | ${license.name}**\n` +
                `Lizenz: **${license.licenseType}**\n` +
                `Seit: **${formatOverwatchDate(license.issuedAt)}** | Fällig ab: **${formatOverwatchDate(license.dueDate)}**\n` +
                `Status: **${license.status.label}** (${license.status.days} Tag(e))`
            );
        })
        .join("\n\n");

    const embed = new EmbedBuilder()
        .setColor(0xfacc15)
        .setTitle("📋 Overwatch Auffrischungs-Übersicht")
        .setDescription(
            "Hier sind alle Lizenzen, die **bald fällig** oder bereits **auffrischungspflichtig** sind.\n\n" +
            listText
        )
        .addFields(
            {
                name: "📌 Hinweis",
                value: dueLicenses.length > 20
                    ? `Es werden nur die ersten 20 von ${dueLicenses.length} Einträgen angezeigt. Die vollständige Liste ist auf der Website.`
                    : "Die vollständige Liste ist auch auf der Website sichtbar.",
                inline: false
            }
        )
        .setFooter({
            text: "LSMD Overwatch-System • Fällige anzeigen",
            iconURL: LSMD_LOGO_URL
        })
        .setTimestamp();

    return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isButton() && interaction.customId === "overwatch_refresh_start") {
    const licensesRaw = await overwatchLicensesCollection
        .find({})
        .sort({ issuedAt: 1, createdAt: 1 })
        .limit(25)
        .toArray();

    if (licensesRaw.length === 0) {
        return interaction.reply({
            content: "❌ Es sind noch keine Overwatch-Lizenzen eingetragen.",
            flags: MessageFlags.Ephemeral
        });
    }

    const options = licensesRaw.map((license) => {
        const status = getOverwatchStatus(license.issuedAt);

        return {
            label: `${license.dn} | ${license.name}`.slice(0, 100),
            value: license._id.toString(),
            description: `${license.licenseType} • ${status.label}`.slice(0, 100),
            emoji: status.key === "red" ? "🔴" : status.key === "yellow" ? "🟡" : "✅"
        };
    });

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("overwatch_refresh_select")
            .setPlaceholder("Lizenz auswählen für Auffrischung")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options)
    );

    return interaction.reply({
        content: "Wähle die Lizenz aus, die aufgefrischt wurde:",
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isStringSelectMenu() && interaction.customId === "overwatch_refresh_select") {
    const licenseId = interaction.values[0];

    let license;

    try {
        license = await overwatchLicensesCollection.findOne({
            _id: new ObjectId(licenseId)
        });
    } catch (err) {
        return interaction.update({
            content: "❌ Ungültige Lizenz-ID.",
            components: []
        });
    }

    if (!license) {
        return interaction.update({
            content: "❌ Lizenz wurde nicht gefunden.",
            components: []
        });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newDueDate = getOverwatchDueDate(today);
    const status = getOverwatchStatus(today);

    await overwatchLicensesCollection.updateOne(
        { _id: license._id },
        {
            $set: {
                issuedAt: today,
                dueDate: newDueDate,
                refreshedAt: new Date(),
                refreshedBy: interaction.user.id,
                refreshedByName: interaction.user.tag,
                lastReminderAt: null,
                lastReminderDayKey: null,
                lastReminderLevel: null,
                updatedAt: new Date()
            }
        }
    );

    const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("✅ Overwatch Auffrischung eingetragen")
        .setDescription(
            `**${license.dn} | ${license.name}** wurde über das Discord-Panel aufgefrischt.\n\n` +
            "Die Lizenz ist jetzt wieder gültig und wird auf der Website wieder grün angezeigt."
        )
        .addFields(
            {
                name: "👤 Mitglied",
                value: `**${license.dn} | ${license.name}**`,
                inline: false
            },
            {
                name: "👁️ Lizenz",
                value: `**${license.licenseType}**`,
                inline: true
            },
            {
                name: "📅 Neues Datum",
                value: `**${formatOverwatchDate(today)}**`,
                inline: true
            },
            {
                name: "⏰ Nächste Auffrischung",
                value: `**${formatOverwatchDate(newDueDate)}**`,
                inline: true
            },
            {
                name: "📌 Status",
                value: `${status.emoji} **${status.label}**`,
                inline: true
            },
            {
                name: "✅ Aufgefrischt von",
                value: `<@${interaction.user.id}>`,
                inline: true
            }
        )
        .setFooter({
            text: "LSMD Overwatch-System • Discord Panel",
            iconURL: LSMD_LOGO_URL
        })
        .setTimestamp();

    if (OVERWATCH_REMINDER_CHANNEL_ID) {
        const reminderChannel = await botClient.channels.fetch(OVERWATCH_REMINDER_CHANNEL_ID).catch(() => null);

        if (reminderChannel) {
            await reminderChannel.send({
                embeds: [embed],
                allowedMentions: {
                    parse: []
                }
            });
        }
    }

    if (OVERWATCH_LOG_CHANNEL_ID) {
        const logChannel = await botClient.channels.fetch(OVERWATCH_LOG_CHANNEL_ID).catch(() => null);

        if (logChannel) {
            await logChannel.send({
                embeds: [embed],
                allowedMentions: {
                    parse: []
                }
            });
        }
    }

    await addLog("Overwatch Auffrischung über Discord Panel abgeschlossen", {
        id: license._id.toString(),
        dn: license.dn,
        name: license.name,
        licenseType: license.licenseType,
        refreshedBy: interaction.user.id
    }, {
        id: interaction.user.id,
        discordId: interaction.user.id,
        username: interaction.user.tag
    });

    return interaction.update({
        content: "✅ Auffrischung wurde gespeichert. Website ist wieder grün.",
        embeds: [],
        components: []
    });
}

if (interaction.isButton() && interaction.customId === "overwatch_license_start") {
    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("overwatch_license_type")
            .setPlaceholder("Lizenz auswählen")
            .addOptions(
                {
                    label: "Overwatch",
                    value: "Overwatch",
                    emoji: "👁️"
                },
                {
                    label: "Overwatch+",
                    value: "Overwatch+",
                    emoji: "👁️"
                },
                {
                    label: "Osprey",
                    value: "Osprey",
                    emoji: "🦅"
                }
            )
    );

    return interaction.reply({
        content: "Bitte wähle aus, welche Lizenz eingetragen werden soll:",
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isStringSelectMenu() && interaction.customId === "overwatch_license_type") {
    const licenseType = interaction.values[0];

    overwatchTempData.set(interaction.user.id, {
        licenseType
    });

    const modal = new ModalBuilder()
        .setCustomId("overwatch_license_modal")
        .setTitle("Overwatch Lizenz eintragen");

    const dnInput = new TextInputBuilder()
        .setCustomId("dn")
        .setLabel("Dienstnummer")
        .setPlaceholder("z. B. MD-03")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const nameInput = new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Name")
        .setPlaceholder("z. B. Prof. Dr. Kevin Fresh")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const dateInput = new TextInputBuilder()
        .setCustomId("issuedAt")
        .setLabel("Lizenz seit wann?")
        .setPlaceholder("Format: 2026-06-12")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const examinerInput = new TextInputBuilder()
        .setCustomId("examiner")
        .setLabel("Prüfer / Ausbilder")
        .setPlaceholder("z. B. Karim")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const notesInput = new TextInputBuilder()
        .setCustomId("notes")
        .setLabel("Notiz optional")
        .setPlaceholder("z. B. Auffrischung bestanden")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(dnInput),
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(dateInput),
        new ActionRowBuilder().addComponents(examinerInput),
        new ActionRowBuilder().addComponents(notesInput)
    );

    return interaction.showModal(modal);
}

if (interaction.isModalSubmit() && interaction.customId === "overwatch_license_modal") {
    const temp = overwatchTempData.get(interaction.user.id);

    if (!temp) {
        return interaction.reply({
            content: "❌ Bitte starte den Vorgang erneut über das Overwatch-Panel.",
            flags: MessageFlags.Ephemeral
        });
    }

    const dn = interaction.fields.getTextInputValue("dn");
    const name = interaction.fields.getTextInputValue("name");
    const issuedAt = interaction.fields.getTextInputValue("issuedAt");
    const examiner = interaction.fields.getTextInputValue("examiner");
    const notes = interaction.fields.getTextInputValue("notes") || "";

    const issuedDate = normalizeOverwatchDate(issuedAt);

    if (!issuedDate) {
        return interaction.reply({
            content: "❌ Ungültiges Datum. Bitte nutze dieses Format: `2026-06-12`",
            flags: MessageFlags.Ephemeral
        });
    }

    const status = getOverwatchStatus(issuedDate);
    const dueDate = getOverwatchDueDate(issuedDate);

    const doc = {
        dn,
        name,
        licenseType: temp.licenseType,
        issuedAt: issuedDate,
        dueDate,
        examiner,
        notes,
        source: "discord-panel",
        createdBy: interaction.user.id,
        createdByName: interaction.user.tag,
        lastReminderAt: null,
        lastReminderLevel: null,
        refreshedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
    };

    const insertResult = await overwatchLicensesCollection.insertOne(doc);

    overwatchTempData.delete(interaction.user.id);

    const embed = new EmbedBuilder()
        .setColor(status.color)
        .setTitle("✅ Overwatch Lizenz eingetragen")
        .setDescription(
            `Die Lizenz wurde erfolgreich gespeichert und erscheint jetzt auch auf der Website.`
        )
        .addFields(
            {
                name: "👤 Mitglied",
                value: `**${dn} | ${name}**`,
                inline: false
            },
            {
                name: "👁️ Lizenz",
                value: `**${temp.licenseType}**`,
                inline: true
            },
            {
                name: "📅 Seit",
                value: `**${formatOverwatchDate(issuedDate)}**`,
                inline: true
            },
            {
                name: "⏰ Fällig ab",
                value: `**${formatOverwatchDate(dueDate)}**`,
                inline: true
            },
            {
                name: "📌 Status",
                value: `${status.emoji} **${status.label}**`,
                inline: true
            },
            {
                name: "👨‍🏫 Prüfer",
                value: `**${examiner}**`,
                inline: true
            },
            {
                name: "✍️ Eingetragen von",
                value: `<@${interaction.user.id}>`,
                inline: true
            }
        )
        .setFooter({
            text: "LSMD Overwatch-System",
            iconURL: LSMD_LOGO_URL
        })
        .setTimestamp();

    if (notes.trim() !== "") {
        embed.addFields({
            name: "📝 Notiz",
            value: notes.slice(0, 1000),
            inline: false
        });
    }

    if (OVERWATCH_LOG_CHANNEL_ID) {
        const logChannel = await botClient.channels.fetch(OVERWATCH_LOG_CHANNEL_ID).catch(() => null);

        if (logChannel) {
            await logChannel.send({
                embeds: [embed],
                allowedMentions: {
                    parse: []
                }
            });
        }
    }

    await addLog("Overwatch Lizenz eingetragen", {
        id: insertResult.insertedId.toString(),
        dn,
        name,
        licenseType: temp.licenseType,
        issuedAt,
        examiner,
        source: "discord-panel"
    }, {
        id: interaction.user.id,
        discordId: interaction.user.id,
        username: interaction.user.tag
    });

    return interaction.reply({
        content: "✅ Lizenz wurde gespeichert und ist auf der Website verfügbar.",
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isButton() && interaction.customId.startsWith("overwatch_refresh_done_")) {
    const licenseId = interaction.customId.replace("overwatch_refresh_done_", "");

    let license;

    try {
        license = await overwatchLicensesCollection.findOne({
            _id: new ObjectId(licenseId)
        });
    } catch (err) {
        return interaction.reply({
            content: "❌ Ungültige Lizenz-ID.",
            flags: MessageFlags.Ephemeral
        });
    }

    if (!license) {
        return interaction.reply({
            content: "❌ Lizenz wurde nicht gefunden.",
            flags: MessageFlags.Ephemeral
        });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newDueDate = getOverwatchDueDate(today);
    const status = getOverwatchStatus(today);

    await overwatchLicensesCollection.updateOne(
        { _id: license._id },
        {
            $set: {
                issuedAt: today,
                dueDate: newDueDate,
                refreshedAt: new Date(),
                refreshedBy: interaction.user.id,
                refreshedByName: interaction.user.tag,
                lastReminderAt: null,
                lastReminderDayKey: null,
                lastReminderLevel: null,
                updatedAt: new Date()
            }
        }
    );

    const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("✅ Overwatch Auffrischung abgeschlossen")
        .setDescription(
            `**${license.dn} | ${license.name}** wurde erfolgreich aufgefrischt.\n\n` +
            "Die Lizenz ist jetzt wieder gültig und wird auf der Website wieder grün angezeigt."
        )
        .addFields(
            {
                name: "👤 Mitglied",
                value: `**${license.dn} | ${license.name}**`,
                inline: false
            },
            {
                name: "👁️ Lizenz",
                value: `**${license.licenseType}**`,
                inline: true
            },
            {
                name: "📅 Neues Datum",
                value: `**${formatOverwatchDate(today)}**`,
                inline: true
            },
            {
                name: "⏰ Nächste Auffrischung",
                value: `**${formatOverwatchDate(newDueDate)}**`,
                inline: true
            },
            {
                name: "📌 Status",
                value: `${status.emoji} **${status.label}**`,
                inline: true
            },
            {
                name: "✅ Aufgefrischt von",
                value: `<@${interaction.user.id}>`,
                inline: true
            }
        )
        .setFooter({
            text: "LSMD Overwatch-System • Auffrischung abgeschlossen",
            iconURL: LSMD_LOGO_URL
        })
        .setTimestamp();

    await interaction.update({
        embeds: [embed],
        components: []
    });

    if (OVERWATCH_LOG_CHANNEL_ID) {
        const logChannel = await botClient.channels.fetch(OVERWATCH_LOG_CHANNEL_ID).catch(() => null);

        if (logChannel) {
            await logChannel.send({
                embeds: [embed],
                allowedMentions: {
                    parse: []
                }
            });
        }
    }

    await addLog("Overwatch Auffrischung abgeschlossen", {
        id: license._id.toString(),
        dn: license.dn,
        name: license.name,
        licenseType: license.licenseType,
        refreshedBy: interaction.user.id
    }, {
        id: interaction.user.id,
        discordId: interaction.user.id,
        username: interaction.user.tag
    });

    return;
}

if (interaction.isButton() && interaction.customId === "attest_open_modal") {
    const modal = new ModalBuilder()
        .setCustomId("attest_patient_modal")
        .setTitle("Attest ausstellen");

    const patientInput = new TextInputBuilder()
        .setCustomId("patient_dn_name")
        .setLabel("Name vom Patienten")
        .setPlaceholder("z. B. Max Mustermann")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(patientInput);

    modal.addComponents(row);

    return interaction.showModal(modal);
}

if (interaction.isModalSubmit() && interaction.customId === "attest_patient_modal") {
    const patientName = interaction.fields.getTextInputValue("patient_dn_name");

    attestTempData.set(interaction.user.id, {
    patientName
});
    
    const attestOptions = Object.entries(attestListe).map(([key, attest]) => ({
        label: attest.name,
        value: key,
        description: `${attest.gueltigkeit} | ${attest.stunden} Stunden`
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("attest_select_type")
        .setPlaceholder("Attest auswählen")
        .addOptions(attestOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return interaction.reply({
        content: "Bitte wähle jetzt das Attest aus:",
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isStringSelectMenu() && interaction.customId === "attest_select_type") {
    const selectedAttest = interaction.values[0];
    const data = attestTempData.get(interaction.user.id);

    if (!data) {
        return interaction.reply({
            content: "Fehler: Deine Eingabe wurde nicht gefunden. Bitte starte erneut.",
            flags: MessageFlags.Ephemeral
        });
    }

    data.attestKey = selectedAttest;
    attestTempData.set(interaction.user.id, data);

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId("attest_select_approved_by")
        .setPlaceholder("Genehmigt von auswählen")
        .setMinValues(1)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(userSelect);

    return interaction.update({
        content: "Bitte wähle jetzt aus, wer das Attest genehmigt hat:",
        components: [row]
    });
}

if (interaction.isUserSelectMenu() && interaction.customId === "attest_select_approved_by") {
    const approvedUserId = interaction.values[0];
    const approvedUser = `<@${approvedUserId}>`;

    const data = attestTempData.get(interaction.user.id);

    if (!data || !data.attestKey) {
        return interaction.reply({
            content: "Fehler: Daten fehlen. Bitte starte erneut.",
            flags: MessageFlags.Ephemeral
        });
    }

    const attest = attestListe[data.attestKey];

    if (!attest) {
        return interaction.reply({
            content: "Fehler: Attest wurde nicht gefunden.",
            flags: MessageFlags.Ephemeral
        });
    }

    const attestEmbed = new EmbedBuilder()
        .setColor(0x06b6d4)
        .setTitle("✅ LSMD Attest ausgestellt")
        .setDescription("Ein neues Attest wurde offiziell ausgestellt.")
        .addFields(
            {
                name: "👤 Patient",
                value: data.patientName,
                inline: false
            },
            {
                name: "📄 Attest",
                value: attest.name,
                inline: true
            },
            {
                name: "⏳ Gültigkeit",
                value: attest.gueltigkeit,
                inline: true
            },
            {
                name: "🕒 Benötigte Stunden",
                value: attest.stunden,
                inline: true
            },
            {
                name: "📋 Inhalt",
                value: attest.inhalt,
                inline: false
            },
            {
                name: "✅ Genehmigt von",
                value: approvedUser,
                inline: true
            },
            {
                name: "✍️ Ausgestellt von",
                value: `<@${interaction.user.id}>`,
                inline: true
            }
        )
        .setFooter({ text: "LSMD Therapeuten-Abteilung" })
        .setTimestamp();

    attestTempData.delete(interaction.user.id);

    await interaction.update({
        content: "✅ Attest wurde erfolgreich ausgestellt und in den Ausgabe-Channel gesendet.",
        components: []
    });

    if (!process.env.ATTEST_AUSGABE_CHANNEL_ID) {
        return interaction.followUp({
            content: "Fehler: ATTEST_AUSGABE_CHANNEL_ID fehlt.",
            flags: MessageFlags.Ephemeral
        });
    }

    const ausgabeChannel = await botClient.channels.fetch(process.env.ATTEST_AUSGABE_CHANNEL_ID).catch(() => null);

    if (!ausgabeChannel) {
        return interaction.followUp({
            content: "Fehler: Attest-Ausgabe-Channel wurde nicht gefunden.",
            flags: MessageFlags.Ephemeral
        });
    }

    return ausgabeChannel.send({
        embeds: [attestEmbed],
        allowedMentions: {
            parse: []
        }
    });
}

if (interaction.isButton() && interaction.customId === "email_open_modal") {
    const modal = new ModalBuilder()
        .setCustomId("email_submit_modal")
        .setTitle("E-Mail-Adresse eintragen");

    const emailInput = new TextInputBuilder()
        .setCustomId("email_address")
        .setLabel("Deine E-Mail-Adresse")
        .setPlaceholder("beispiel@email.com")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

    const row = new ActionRowBuilder().addComponents(emailInput);

    modal.addComponents(row);

    return interaction.showModal(modal);
}

if (interaction.isModalSubmit() && interaction.customId === "email_submit_modal") {
    const email = interaction.fields.getTextInputValue("email_address").trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
        return interaction.reply({
            content: "❌ Bitte gib eine gültige E-Mail-Adresse ein.",
            flags: MessageFlags.Ephemeral
        });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

    if (!member) {
        return interaction.reply({
            content: "❌ Dein Discord-Mitglied konnte nicht geladen werden.",
            flags: MessageFlags.Ephemeral
        });
    }

    const targets = getEmailTargetChannels(member);

    if (!targets.length) {
        return interaction.reply({
            content: "❌ Ich konnte keine passende Abteilung anhand deiner Rollen erkennen.",
            flags: MessageFlags.Ephemeral
        });
    }

    const sentDepartments = [];

    for (const target of targets) {
        const logChannel = await interaction.guild.channels.fetch(target.channelId).catch(() => null);

        if (!logChannel) {
            console.log(`E-Mail-Channel nicht gefunden: ${target.department}`);
            continue;
        }

        const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("E-Mail hinterlegt")
    .setDescription(
        `**Mitarbeiter:** <@${interaction.user.id}>\n` +
        `**Name:** ${member.displayName || interaction.user.username}\n` +
        `**Discord-ID:** \`${interaction.user.id}\`\n` +
        `**E-Mail:** \`${email}\``
    )
    .setThumbnail(LSMD_LOGO_URL)
    .setFooter({
        text: "Medical Department | LSMD – Made by Karim",
        iconURL: LSMD_LOGO_URL
    })
    .setTimestamp();

        await logChannel.send({
            embeds: [embed],
            allowedMentions: {
                parse: []
            }
        });

        sentDepartments.push(target.department);
    }

    if (!sentDepartments.length) {
        return interaction.reply({
            content: "❌ Es wurde keine E-Mail gespeichert, weil kein Ziel-Channel erreichbar war.",
            flags: MessageFlags.Ephemeral
        });
    }

    return interaction.reply({
        content:
            "✅ Deine E-Mail wurde sicher hinterlegt.\n\n" +
            `📂 Zugeordnet zu: **${sentDepartments.join("**, **")}**`,
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isUserSelectMenu() && interaction.customId === "prof_professor_select") {
    const selectedProfessorId = interaction.values[0];

    const member = await interaction.guild.members.fetch(selectedProfessorId).catch(() => null);

    if (!member) {
        return interaction.reply({
            content: "❌ Professor konnte nicht geladen werden.",
            flags: MessageFlags.Ephemeral
        });
    }

    const professorName = member.displayName || member.user.username;
    const professorDn = extractDnFromName(professorName);

    if (!professorDn) {
        return interaction.reply({
            content:
                "❌ Ich konnte keine DN aus dem Namen erkennen.\n\n" +
                "Der Professor muss z.B. so heißen:\n" +
                "`[MD-17] Prof Dr. Karim`",
            flags: MessageFlags.Ephemeral
        });
    }

    const current = profLogSelections.get(interaction.user.id) || {};

    current.professorId = selectedProfessorId;
    current.professorName = professorName;
    current.professorDn = professorDn;

    profLogSelections.set(interaction.user.id, current);

    return interaction.reply({
        content: `✅ Professor ausgewählt: **${professorName}** | DN **${professorDn}**`,
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isStringSelectMenu() && interaction.customId === "prof_rank_select") {
    const selectedRank = interaction.values[0];

    const current = profLogSelections.get(interaction.user.id) || {};
    current.rank = selectedRank;

    profLogSelections.set(interaction.user.id, current);

    return interaction.reply({
        content: `✅ Weiterbildung/Rang ausgewählt: **${selectedRank}**`,
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isButton() && interaction.customId === "prof_points_show") {
    try {
        if (!isProfessorenLeitung(interaction)) {
            return interaction.reply({
                content: "❌ Nur die Professoren-Leitung darf Professoren-Punkte anschauen.",
                flags: MessageFlags.Ephemeral
            });
        }

        const selection = profLogSelections.get(interaction.user.id);

        if (!selection || !selection.professorDn) {
            return interaction.reply({
                content: "❌ Bitte zuerst einen **Professor** auswählen.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        const sheetData = await professorSheetAction(selection.professorDn, "get", 0);

        if (!sheetData) {
            return interaction.editReply({
                content: "❌ Punkte konnten nicht aus dem Mastersheet gelesen werden."
            });
        }

        const points =
            sheetData.points ??
            sheetData.newPoints ??
            sheetData.oldPoints ??
            0;

        return interaction.editReply({
            content:
                `📊 **Professoren Punkte**\n\n` +
                `👨‍🏫 Professor: <@${selection.professorId}>\n` +
                `📛 Name: **${selection.professorName}**\n` +
                `🔢 DN: **${selection.professorDn}**\n` +
                `🏆 Prof-Punkte: **${points}**`
        });
    } catch (err) {
        console.error("Fehler bei prof_points_show:", err);

        if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({
                content: "❌ Fehler beim Anzeigen der Professoren-Punkte.",
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.editReply({
            content: "❌ Fehler beim Anzeigen der Professoren-Punkte."
        });
    }
}

if (
    interaction.isButton() &&
    (
        interaction.customId === "prof_points_edit" ||
        interaction.customId === "prof_points_add" ||
        interaction.customId === "prof_points_remove"
    )
) {
    try {
        if (!isProfessorenLeitung(interaction)) {
            return interaction.reply({
                content: "❌ Nur die Professoren-Leitung darf Professoren-Punkte bearbeiten.",
                flags: MessageFlags.Ephemeral
            });
        }

        const selection = profLogSelections.get(interaction.user.id);

        if (!selection || !selection.professorDn) {
            return interaction.reply({
                content: "❌ Bitte zuerst einen **Professor** auswählen.",
                flags: MessageFlags.Ephemeral
            });
        }

        const actionMap = {
            prof_points_edit: "set",
            prof_points_add: "add",
            prof_points_remove: "remove"
        };

        const action = actionMap[interaction.customId];

        const modal = new ModalBuilder()
            .setCustomId(`prof_points_modal_${action}`)
            .setTitle("Professoren Punkte bearbeiten");

        const pointsInput = new TextInputBuilder()
            .setCustomId("points")
            .setLabel(
                action === "set"
                    ? "Neue Punktzahl setzen"
                    : action === "add"
                        ? "Wie viele Punkte vergeben?"
                        : "Wie viele Punkte entfernen?"
            )
            .setPlaceholder("z.B. 1")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const reasonInput = new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Grund / Notiz")
            .setPlaceholder("z.B. Korrektur, Nachtrag, falscher Eintrag")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(pointsInput),
            new ActionRowBuilder().addComponents(reasonInput)
        );

        return interaction.showModal(modal);
    } catch (err) {
        console.error("Fehler beim Öffnen vom Professoren Punkte Modal:", err);

        return interaction.reply({
            content: "❌ Punkte-Modal konnte nicht geöffnet werden.",
            flags: MessageFlags.Ephemeral
        });
    }
}

if (interaction.isButton() && interaction.customId === "prof_log_create") {
    const selection = profLogSelections.get(interaction.user.id);

    if (!selection || !selection.professorId || !selection.professorDn || !selection.rank) {
        return interaction.reply({
            content: "❌ Bitte zuerst **Professor** und **Weiterbildung/Rang** auswählen.",
            flags: MessageFlags.Ephemeral
        });
    }

    const modal = new ModalBuilder()
        .setCustomId("prof_log_modal")
        .setTitle("Professoren Schüler-Log");

    const studentInput = new TextInputBuilder()
        .setCustomId("student")
        .setLabel("Schüler Name / DN")
        .setPlaceholder("z.B. [MD-41] Max Mustermann")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const noteInput = new TextInputBuilder()
        .setCustomId("note")
        .setLabel("Bemerkung / Nachweis")
        .setPlaceholder("z.B. bestanden, sauber durchgeführt, Nachweis vorhanden")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(studentInput),
        new ActionRowBuilder().addComponents(noteInput)
    );

    return interaction.showModal(modal);
}

if (interaction.isModalSubmit() && interaction.customId.startsWith("prof_points_modal_")) {
    try {
        if (!isProfessorenLeitung(interaction)) {
            return interaction.reply({
                content: "❌ Nur die Professoren-Leitung darf Professoren-Punkte bearbeiten.",
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        const action = interaction.customId.replace("prof_points_modal_", "");
        const selection = profLogSelections.get(interaction.user.id);

        if (!selection || !selection.professorDn) {
            return interaction.editReply({
                content: "❌ Auswahl wurde nicht gefunden. Bitte Professor erneut auswählen."
            });
        }

        const pointsRaw = interaction.fields.getTextInputValue("points");
        const reason = interaction.fields.getTextInputValue("reason") || "Keine Notiz";

        const points = parseInt(pointsRaw.replace(/\D/g, ""), 10);

        if (isNaN(points) || points < 0 || points > 999) {
            return interaction.editReply({
                content: "❌ Bitte gib eine gültige Punktzahl zwischen 0 und 999 ein."
            });
        }

        const sheetUpdate = await professorSheetAction(selection.professorDn, action, points);

        if (!sheetUpdate) {
            return interaction.editReply({
                content: "❌ Mastersheet konnte nicht aktualisiert werden."
            });
        }

        let actionText = "bearbeitet";

        if (action === "set") {
            actionText = "gesetzt";
        }

        if (action === "add") {
            actionText = "vergeben";
        }

        if (action === "remove") {
            actionText = "entfernt";
        }

        const oldPoints = sheetUpdate.oldPoints ?? 0;
        const newPoints = sheetUpdate.newPoints ?? sheetUpdate.points ?? 0;

        const embed = new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle("🔐 Professoren-Leitung | Punkte aktualisiert")
            .addFields(
                {
                    name: "👨‍🏫 Professor",
                    value: `<@${selection.professorId}>\n${selection.professorName}\nDN ${selection.professorDn}`,
                    inline: true
                },
                {
                    name: "📌 Aktion",
                    value: actionText,
                    inline: true
                },
                {
                    name: "📊 Änderung",
                    value: `${oldPoints} → ${newPoints} Prof-Punkte`,
                    inline: false
                },
                {
                    name: "📝 Grund",
                    value: reason,
                    inline: false
                },
                {
                    name: "📨 Eingetragen von",
                    value: `<@${interaction.user.id}>`,
                    inline: true
                },
                {
                    name: "📅 Datum",
                    value: `<t:${Math.floor(Date.now() / 1000)}:f>`,
                    inline: true
                }
            )
            .setFooter({ text: "LSMD Professoren-Abteilung | Punkteverwaltung" })
            .setTimestamp();

        const logChannel = PROFESSOREN_LEITUNG_LOG_CHANNEL_ID
    ? await botClient.channels.fetch(PROFESSOREN_LEITUNG_LOG_CHANNEL_ID).catch(() => null)
    : null;

        if (logChannel) {
            await logChannel.send({
                embeds: [embed],
                allowedMentions: {
                    parse: []
                }
            });
        }

        return interaction.editReply({
            content:
                `✅ Punkte wurden erfolgreich ${actionText}.\n` +
                `📊 **${oldPoints} → ${newPoints} Prof-Punkte**`
        });
    } catch (err) {
        console.error("Fehler bei prof_points_modal:", err);

        if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({
                content: "❌ Fehler beim Bearbeiten der Professoren-Punkte.",
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.editReply({
            content: "❌ Fehler beim Bearbeiten der Professoren-Punkte."
        });
    }
}

if (interaction.isModalSubmit() && interaction.customId === "prof_log_modal") {
    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const selection = profLogSelections.get(interaction.user.id);

    if (!selection || !selection.professorId || !selection.professorDn || !selection.rank) {
        return interaction.reply({
            content: "❌ Auswahl wurde nicht gefunden. Bitte Professor und Weiterbildung erneut auswählen.",
            flags: MessageFlags.Ephemeral
        });
    }

    const professorId = selection.professorId;
    const professorName = selection.professorName;
    const professorDn = selection.professorDn;
    const rank = selection.rank;

    const student = interaction.fields.getTextInputValue("student");
    const note = interaction.fields.getTextInputValue("note") || "Keine Bemerkung";
    const points = 1;

    const sheetUpdate = await updateProfessorPointsInSheet(professorDn, points);

    const embed = new EmbedBuilder()
        .setColor(sheetUpdate ? 0x22c55e : 0xef4444)
        .setTitle("📘 Neuer Professoren Schüler-Log")
        .setDescription(
            sheetUpdate
                ? "Ein Schüler-Log wurde eingetragen und automatisch mit **+1 Punkt** bewertet."
                : "Ein Schüler-Log wurde eingetragen, aber das **Mastersheet konnte nicht aktualisiert werden**."
        )
        .addFields(
            {
                name: "👨‍🏫 Professor",
                value: `<@${professorId}>\n${professorName}\nDN ${professorDn}`,
                inline: true
            },
            {
                name: "👤 Schüler",
                value: student,
                inline: true
            },
            {
                name: "📚 Weiterbildung / Rang",
                value: rank,
                inline: false
            },
            {
                name: "📌 Log",
                value: `Schüler-Weiterbildung zu **${rank}** wurde eingetragen.`,
                inline: false
            },
            {
                name: "🏆 Punkte",
                value: "+1 Punkt",
                inline: true
            },
            {
                name: "📊 Mastersheet",
                value: sheetUpdate
                    ? `${sheetUpdate.oldPoints} → ${sheetUpdate.newPoints} Prof-Punkte`
                    : "❌ Konnte nicht im Mastersheet aktualisiert werden.",
                inline: true
            },
            {
                name: "📝 Bemerkung",
                value: note,
                inline: false
            },
            {
                name: "📅 Datum",
                value: `<t:${Math.floor(Date.now() / 1000)}:f>`,
                inline: true
            },
            {
                name: "📨 Eingetragen von",
                value: `<@${interaction.user.id}>`,
                inline: true
            }
        )
        .setFooter({ text: "LSMD Professoren-Abteilung | Schüler-System" })
        .setTimestamp();

    const logChannel = PROFESSOREN_SCHUELER_LOG_CHANNEL_ID
        ? await botClient.channels.fetch(PROFESSOREN_SCHUELER_LOG_CHANNEL_ID).catch(() => null)
        : null;

    if (!logChannel) {
        return interaction.editReply({
            content: "❌ Logs-Channel wurde nicht gefunden. Bitte `PROFESSOREN_SCHUELER_LOG_CHANNEL_ID` in Railway setzen.",
        });
    }

    await logChannel.send({
        embeds: [embed],
        allowedMentions: {
            parse: []
        }
    });

    await interaction.editReply({
    content: sheetUpdate
        ? "✅ Schüler-Log wurde eingetragen. Der Professor hat **+1 Prof-Punkt** erhalten."
        : "⚠️ Schüler-Log wurde gesendet, aber das Mastersheet wurde **nicht** aktualisiert."
});

    profLogSelections.delete(interaction.user.id);

    await sendProfessorenSchuelerSystemPanel().catch(err => {
        console.error("Professoren Panel konnte nicht zurückgesetzt werden:", err);
    });

    return;
}

if (interaction.isButton() && interaction.customId === "bewerbung_open_modal") {
    if (!isDiscordLeadership(interaction)) {
        return interaction.reply({
            content: "❌ Nur die Leitung darf Bewerbungen eintragen.",
            flags: MessageFlags.Ephemeral
        });
    }

    const modal = new ModalBuilder()
        .setCustomId("bewerbung_submit_modal")
        .setTitle("LSMD Bewerbung eintragen");

    const nameDnInput = new TextInputBuilder()
        .setCustomId("bewerbung_name_dn")
        .setLabel("Name und DN")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setPlaceholder("z.B. DN 1234 | Max Mustermann");

    const discordSteamInput = new TextInputBuilder()
        .setCustomId("bewerbung_discord_steam")
        .setLabel("Discord / Steam")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
        .setPlaceholder("z.B. @Name oder Steam-ID");

    const positionInput = new TextInputBuilder()
        .setCustomId("bewerbung_position")
        .setLabel("Bewerbung für")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
        .setPlaceholder("z.B. Ausbilder");

    const documentInput = new TextInputBuilder()
        .setCustomId("bewerbung_document")
        .setLabel("Google Docs Link")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(300)
        .setPlaceholder("https://docs.google.com/...");

    const summaryInput = new TextInputBuilder()
        .setCustomId("bewerbung_summary")
        .setLabel("Kurze Zusammenfassung")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(900)
        .setPlaceholder("Kurze Info zur Bewerbung...");

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameDnInput),
        new ActionRowBuilder().addComponents(discordSteamInput),
        new ActionRowBuilder().addComponents(positionInput),
        new ActionRowBuilder().addComponents(documentInput),
        new ActionRowBuilder().addComponents(summaryInput)
    );

    return interaction.showModal(modal);
}

if (interaction.isModalSubmit() && interaction.customId === "bewerbung_submit_modal") {
    if (!isDiscordLeadership(interaction)) {
        return interaction.reply({
            content: "❌ Nur die Leitung darf Bewerbungen eintragen.",
            flags: MessageFlags.Ephemeral
        });
    }

    const requestId = String(bewerbungRequestCounter++);

    const request = {
        id: requestId,
        nameDn: interaction.fields.getTextInputValue("bewerbung_name_dn"),
        discordSteam: interaction.fields.getTextInputValue("bewerbung_discord_steam"),
        position: interaction.fields.getTextInputValue("bewerbung_position"),
        documentUrl: interaction.fields.getTextInputValue("bewerbung_document"),
        summary: interaction.fields.getTextInputValue("bewerbung_summary"),
        createdBy: interaction.user.id,
        status: "offen",
        votes: {},
        messageId: null,
        channelId: interaction.channel.id,
        decidedBy: null
    };

    const content = BEWERBUNG_PING_ROLE_IDS.length
        ? BEWERBUNG_PING_ROLE_IDS.map(roleId => `<@&${roleId}>`).join(" ")
        : "";

    const message = await interaction.channel.send({
        content,
        embeds: [buildBewerbungEmbed(request)],
        components: buildBewerbungComponents(request),
        allowedMentions: {
            roles: BEWERBUNG_PING_ROLE_IDS
        }
    });

    request.messageId = message.id;
    bewerbungRequests.set(requestId, request);

    return interaction.reply({
        content: "✅ Bewerbung wurde eingetragen und wartet jetzt auf Abstimmung der Leitung.",
        flags: MessageFlags.Ephemeral
    });
}

if (
    interaction.isButton() &&
    (
        interaction.customId.startsWith("bewerbung_vote_accept_") ||
        interaction.customId.startsWith("bewerbung_vote_deny_")
    )
) {
    if (!isDiscordLeadership(interaction)) {
        return interaction.reply({
            content: "❌ Nur die Leitung darf abstimmen.",
            flags: MessageFlags.Ephemeral
        });
    }

    const voteType = interaction.customId.startsWith("bewerbung_vote_accept_")
        ? "accept"
        : "deny";

    const requestId = interaction.customId
        .replace("bewerbung_vote_accept_", "")
        .replace("bewerbung_vote_deny_", "");

    const request = bewerbungRequests.get(requestId);

    if (!request) {
        return interaction.reply({
            content: "❌ Diese Bewerbung wurde nicht gefunden oder der Bot wurde neu gestartet.",
            flags: MessageFlags.Ephemeral
        });
    }

    if (request.status !== "offen") {
        return interaction.reply({
            content: "Diese Bewerbung wurde bereits entschieden.",
            flags: MessageFlags.Ephemeral
        });
    }

    request.votes[interaction.user.id] = voteType;

    const stats = getBewerbungVoteStats(request);

    if (stats.accept >= BEWERBUNG_REQUIRED_VOTES) {
        request.status = "angenommen";
        request.decidedBy = interaction.user.id;
    }

    if (stats.deny >= BEWERBUNG_REQUIRED_VOTES) {
        request.status = "abgelehnt";
        request.decidedBy = interaction.user.id;
    }

    bewerbungRequests.set(requestId, request);

    await interaction.message.edit({
        content: request.status === "offen" ? interaction.message.content : "",
        embeds: [buildBewerbungEmbed(request)],
        components: buildBewerbungComponents(request),
        allowedMentions: {
            parse: []
        }
    });

    const voteText = voteType === "accept" ? "✅ Dafür" : "❌ Dagegen";

    return interaction.reply({
        content: `Deine Stimme wurde gespeichert: **${voteText}**`,
        flags: MessageFlags.Ephemeral
    });
}

        if (interaction.isButton() && interaction.customId === "abmeldung_open_modal") {
            const modal = new ModalBuilder()
                .setCustomId("abmeldung_submit_modal")
                .setTitle("LSMD Abmeldung");

            const nameInput = new TextInputBuilder()
                .setCustomId("abmeldung_name")
                .setLabel("Name")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(80)
                .setPlaceholder("z.B. Karim Tranquile");

            const dnInput = new TextInputBuilder()
                .setCustomId("abmeldung_dn")
                .setLabel("Dienstnummer")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(30)
                .setPlaceholder("z.B. MD-23");

            const zeitraumInput = new TextInputBuilder()
                .setCustomId("abmeldung_zeitraum")
                .setLabel("Zeitraum")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100)
                .setPlaceholder("z.B. 10.06.2026 - 14.06.2026");

            const grundInput = new TextInputBuilder()
                .setCustomId("abmeldung_grund")
                .setLabel("Grund")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(500)
                .setPlaceholder("z.B. Urlaub, Krankheit, private Gründe...");

            modal.addComponents(
                new ActionRowBuilder().addComponents(nameInput),
                new ActionRowBuilder().addComponents(dnInput),
                new ActionRowBuilder().addComponents(zeitraumInput),
                new ActionRowBuilder().addComponents(grundInput)
            );

            return interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId === "abmeldung_submit_modal") {
            const name = interaction.fields.getTextInputValue("abmeldung_name");
            const dn = interaction.fields.getTextInputValue("abmeldung_dn");
            const zeitraum = interaction.fields.getTextInputValue("abmeldung_zeitraum");
            const grund = interaction.fields.getTextInputValue("abmeldung_grund");

            const embed = new EmbedBuilder()
                .setColor(0xef233c)
                .setTitle("📌 Neue Abmeldung")
                .setDescription("Eine neue Abmeldung wurde eingereicht.")
                .addFields(
                    {
                        name: "👤 Name",
                        value: `**${name}**`,
                        inline: true
                    },
                    {
                        name: "🆔 Dienstnummer",
                        value: `**${dn}**`,
                        inline: true
                    },
                    {
                        name: "📅 Zeitraum",
                        value: `**${zeitraum}**`,
                        inline: false
                    },
                    {
                        name: "📝 Grund",
                        value: grund,
                        inline: false
                    },
                    {
                        name: "📨 Eingereicht von",
                        value: `<@${interaction.user.id}>`,
                        inline: true
                    },
                    {
                        name: "⏰ Eingereicht am",
                        value: `<t:${Math.floor(Date.now() / 1000)}:f>`,
                        inline: true
                    }
                )
                .setFooter({ text: "LSMD Abmeldungssystem" })
                .setTimestamp();

            const decisionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
        .setCustomId("abmeldung_approve")
        .setLabel("Genehmigen")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
        .setCustomId("abmeldung_reject")
        .setLabel("Ablehnen")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
);

await interaction.channel.send({
    embeds: [embed],
    components: [decisionRow],
    allowedMentions: {
        parse: []
    }
});

            return interaction.reply({
                content: "✅ Deine Abmeldung wurde erfolgreich eingereicht.",
                flags: MessageFlags.Ephemeral
            });
        }


if (interaction.isButton() && interaction.customId === "abmeldung_approve") {
    if (!isDiscordLeadership(interaction)) {
        return interaction.reply({
            content: "Du hast keine Berechtigung, Abmeldungen zu bearbeiten.",
            flags: MessageFlags.Ephemeral
        });
    }

    const oldEmbed = interaction.message.embeds[0];

    const embed = EmbedBuilder.from(oldEmbed)
        .setColor(0x22c55e)
        .setTitle("✅ Abmeldung genehmigt")
        .addFields(
            {
                name: "✅ Genehmigt von",
                value: `<@${interaction.user.id}>`,
                inline: true
            }
        )
        .setFooter({ text: "LSMD Abmeldungssystem • Genehmigt" })
        .setTimestamp();

    await interaction.message.edit({
        embeds: [embed],
        components: []
    });

    return interaction.reply({
        content: "✅ Abmeldung wurde genehmigt.",
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isButton() && interaction.customId === "abmeldung_reject") {
    if (!isDiscordLeadership(interaction)) {
        return interaction.reply({
            content: "Du hast keine Berechtigung, Abmeldungen zu bearbeiten.",
            flags: MessageFlags.Ephemeral
        });
    }

    const modal = new ModalBuilder()
        .setCustomId(`abmeldung_reject_modal_${interaction.message.id}`)
        .setTitle("Abmeldung ablehnen");

    const reasonInput = new TextInputBuilder()
        .setCustomId("abmeldung_reject_reason")
        .setLabel("Grund der Ablehnung")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
        .setPlaceholder("z.B. Zeitraum zu kurz, Angaben fehlen, Rücksprache nötig...");

    modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput)
    );

    return interaction.showModal(modal);
}

if (interaction.isModalSubmit() && interaction.customId.startsWith("abmeldung_reject_modal_")) {
    if (!isDiscordLeadership(interaction)) {
        return interaction.reply({
            content: "Du hast keine Berechtigung, Abmeldungen zu bearbeiten.",
            flags: MessageFlags.Ephemeral
        });
    }

    const messageId = interaction.customId.replace("abmeldung_reject_modal_", "");
    const reason = interaction.fields.getTextInputValue("abmeldung_reject_reason");

    const message = await interaction.channel.messages.fetch(messageId);
    const oldEmbed = message.embeds[0];

    const embed = EmbedBuilder.from(oldEmbed)
        .setColor(0xef233c)
        .setTitle("❌ Abmeldung abgelehnt")
        .addFields(
            {
                name: "❌ Abgelehnt von",
                value: `<@${interaction.user.id}>`,
                inline: true
            },
            {
                name: "📝 Ablehnungsgrund",
                value: reason,
                inline: false
            }
        )
        .setFooter({ text: "LSMD Abmeldungssystem • Abgelehnt" })
        .setTimestamp();

    await message.edit({
        embeds: [embed],
        components: []
    });

    return interaction.reply({
        content: "❌ Abmeldung wurde abgelehnt.",
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isButton() && interaction.customId.startsWith("einstellung_bonus_paid_")) {
    if (!isDiscordLeadership(interaction)) {
        return interaction.reply({
            content: "Du hast keine Berechtigung, Einstellungsboni zu bearbeiten.",
            flags: MessageFlags.Ephemeral
        });
    }

    const bonusId = interaction.customId.replace("einstellung_bonus_paid_", "");

    const bonusDoc = await einstellungsBonusCollection.findOne({
        _id: new ObjectId(bonusId)
    });

    if (!bonusDoc) {
        return interaction.reply({
            content: "Dieser Bonus-Antrag wurde nicht gefunden.",
            flags: MessageFlags.Ephemeral
        });
    }

    const requestGroupId = bonusDoc.requestGroupId || null;

    const bonusDocs = requestGroupId
        ? await einstellungsBonusCollection.find({ requestGroupId }).toArray()
        : [bonusDoc];

    if (bonusDocs.some(doc => doc.status !== "offen")) {
        return interaction.reply({
            content: "Dieser Bonus-Antrag wurde bereits bearbeitet.",
            flags: MessageFlags.Ephemeral
        });
    }

    const newStandFields = [];

    for (const doc of bonusDocs) {
        const aktuellerStand = await getAusbilderBonusStand(doc.ausbilderDiscordId);
        const neuerStand = aktuellerStand + doc.bonus;

        if (neuerStand > EINSTELLUNGS_BONUS_LIMIT) {
            return interaction.reply({
                content: "❌ Bonuslimit wurde bei mindestens einem Ausbilder erreicht.",
                flags: MessageFlags.Ephemeral
            });
        }

        newStandFields.push({
            name: `📊 Neuer Stand <@${doc.ausbilderDiscordId}>`,
            value: `${neuerStand.toLocaleString("de-DE")} $ / ${EINSTELLUNGS_BONUS_LIMIT.toLocaleString("de-DE")} $`,
            inline: false
        });
    }

    if (requestGroupId) {
        await einstellungsBonusCollection.updateMany(
            { requestGroupId },
            {
                $set: {
                    status: "ausgezahlt",
                    paidBy: interaction.user.id,
                    paidAt: new Date(),
                    updatedAt: new Date()
                }
            }
        );
    } else {
        await einstellungsBonusCollection.updateOne(
            { _id: new ObjectId(bonusId) },
            {
                $set: {
                    status: "ausgezahlt",
                    paidBy: interaction.user.id,
                    paidAt: new Date(),
                    updatedAt: new Date()
                }
            }
        );
    }

    const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x22c55e)
        .setTitle("✅ Einstellungsbonus ausgezahlt")
        .addFields(
            {
                name: "✅ Ausgezahlt von",
                value: `<@${interaction.user.id}>`,
                inline: true
            },
            ...newStandFields
        )
        .setFooter({ text: "LSMD Einstellungsbonus • Ausgezahlt" })
        .setTimestamp();

    await interaction.message.edit({
        embeds: [embed],
        components: []
    });

    return interaction.reply({
        content: "✅ Einstellungsbonus wurde als ausgezahlt markiert.",
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isButton() && interaction.customId.startsWith("einstellung_bonus_reject_")) {
    if (!isDiscordLeadership(interaction)) {
        return interaction.reply({
            content: "Du hast keine Berechtigung, Einstellungsboni zu bearbeiten.",
            flags: MessageFlags.Ephemeral
        });
    }

    const bonusId = interaction.customId.replace("einstellung_bonus_reject_", "");

    const modal = new ModalBuilder()
        .setCustomId(`einstellung_bonus_reject_modal_${bonusId}`)
        .setTitle("Einstellungsbonus ablehnen");

    const reasonInput = new TextInputBuilder()
        .setCustomId("einstellung_bonus_reject_reason")
        .setLabel("Grund der Ablehnung")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
        .setPlaceholder("z.B. falsche Angaben, doppelt eingetragen, nicht berechtigt...");

    modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput)
    );

    return interaction.showModal(modal);
}

if (interaction.isModalSubmit() && interaction.customId.startsWith("einstellung_bonus_reject_modal_")) {
    if (!isDiscordLeadership(interaction)) {
        return interaction.reply({
            content: "Du hast keine Berechtigung, Einstellungsboni zu bearbeiten.",
            flags: MessageFlags.Ephemeral
        });
    }

    const bonusId = interaction.customId.replace("einstellung_bonus_reject_modal_", "");
    const reason = interaction.fields.getTextInputValue("einstellung_bonus_reject_reason");

    const bonusDoc = await einstellungsBonusCollection.findOne({
        _id: new ObjectId(bonusId)
    });

    if (!bonusDoc) {
        return interaction.reply({
            content: "Dieser Bonus-Antrag wurde nicht gefunden.",
            flags: MessageFlags.Ephemeral
        });
    }

    if (bonusDoc.status !== "offen") {
        return interaction.reply({
            content: "Dieser Bonus-Antrag wurde bereits bearbeitet.",
            flags: MessageFlags.Ephemeral
        });
    }

    const requestGroupId = bonusDoc.requestGroupId || null;

if (requestGroupId) {
    await einstellungsBonusCollection.updateMany(
        { requestGroupId },
        {
            $set: {
                status: "abgelehnt",
                updatedAt: new Date()
            }
        }
    );
} else {
    await einstellungsBonusCollection.updateOne(
        { _id: new ObjectId(bonusId) },
        {
            $set: {
                status: "abgelehnt",
                updatedAt: new Date()
            }
        }
    );
}

    const bonusChannel = await botClient.channels.fetch(BONUS_HQ_CHANNEL_ID);
    const bonusMessage = await bonusChannel.messages.fetch(bonusDoc.messageId);

    const embed = EmbedBuilder.from(bonusMessage.embeds[0])
        .setColor(0xef233c)
        .setTitle("❌ Einstellungsbonus abgelehnt")
        .addFields(
            {
                name: "❌ Abgelehnt von",
                value: `<@${interaction.user.id}>`,
                inline: true
            },
            {
                name: "📝 Ablehnungsgrund",
                value: reason,
                inline: false
            }
        )
        .setFooter({ text: "LSMD Einstellungsbonus • Abgelehnt" })
        .setTimestamp();

    await bonusMessage.edit({
        embeds: [embed],
        components: []
    });

    return interaction.reply({
        content: "❌ Einstellungsbonus wurde abgelehnt.",
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isUserSelectMenu() && interaction.customId === "einstellung_bonus_helper_select") {
    const helperId = interaction.values[0];

    if (!helperId) {
        bonusHelperSelections.delete(interaction.user.id);

        return interaction.reply({
            content: "Helfer-Auswahl wurde entfernt.",
            flags: MessageFlags.Ephemeral
        });
    }

    if (helperId === interaction.user.id) {
        bonusHelperSelections.delete(interaction.user.id);

        return interaction.reply({
            content: "Du kannst dich nicht selbst als Helfer auswählen.",
            flags: MessageFlags.Ephemeral
        });
    }

    bonusHelperSelections.set(interaction.user.id, helperId);

    return interaction.reply({
        content: `Helfer ausgewählt: <@${helperId}>. Der Bonus wird auf **125.000 $ pro Person** geteilt.`,
        flags: MessageFlags.Ephemeral
    });
}

if (interaction.isButton() && interaction.customId === "einstellung_bonus_open_modal") {
    const modal = new ModalBuilder()
        .setCustomId("einstellung_bonus_submit_modal")
        .setTitle("Einstellungsbonus beantragen");

    const dnInput = new TextInputBuilder()
        .setCustomId("einstellung_bonus_dn")
        .setLabel("Dienstnummer des Eingestellten")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(30)
        .setPlaceholder("z.B. 1234");

    const nameInput = new TextInputBuilder()
        .setCustomId("einstellung_bonus_name")
        .setLabel("Name des Eingestellten")
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

if (interaction.isModalSubmit() && interaction.customId === "einstellung_bonus_submit_modal") {
    const dn = interaction.fields.getTextInputValue("einstellung_bonus_dn");
    const name = interaction.fields.getTextInputValue("einstellung_bonus_name");

    const helperId = bonusHelperSelections.get(interaction.user.id) || null;
bonusHelperSelections.delete(interaction.user.id);

const result = await sendEinstellungsBonusRequest(interaction, {
    dn,
    name,
    helperId
});

    if (!result) {
        return interaction.reply({
            content: "Du hast dein Bonuslimit von 3.000.000 $ bereits erreicht oder der Bonus-HQ Channel ist nicht eingerichtet.",
            flags: MessageFlags.Ephemeral
        });
    }

    return interaction.reply({
        content: "✅ Dein Einstellungsbonus wurde beantragt und wartet auf Auszahlung durch die Leitung.",
        flags: MessageFlags.Ephemeral
    });
}

        if (!canUseSpontanePanel(interaction)) {
            return interaction.reply({
                content: "Du hast keine Berechtigung für dieses Prüfungs-Panel.",
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
                content: `Prüfungsart ausgewählt: **${examType}**. Klicke jetzt auf **Antrag erstellen**.`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (interaction.customId === "spontan_submit") {
            const state = spontaneSelections.get(adminId);

            if (!state || !state.examType) {
                return interaction.reply({
                    content: "Bitte zuerst die Prüfungsart auswählen.",
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
                .setTitle("Spontane Prüfung eintragen");

            const dnInput = new TextInputBuilder()
                .setCustomId("pruefling_dn")
                .setLabel("DN des Prüflings")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(30)
                .setPlaceholder("z.B. 1234");

            const nameInput = new TextInputBuilder()
                .setCustomId("pruefling_name")
                .setLabel("Name des Prüflings")
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
                    content: "Die Prüfungsart fehlt. Bitte Antrag nochmal neu erstellen.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const prueflingDn = interaction.fields.getTextInputValue("pruefling_dn");
            const prueflingName = interaction.fields.getTextInputValue("pruefling_name");

            const requestId = spontaneRequestCounter++;

            const embed = new EmbedBuilder()
                .setColor(0xf59e0b)
                .setTitle("📝 Neuer Antrag: Spontane Prüfung")
                .setDescription(
                    "Ein Prüfling wurde für eine spontane Prüfung eingetragen.\n\n" +
                    "Die Leitung kann diesen Antrag jetzt genehmigen oder ablehnen."
                )
                .addFields(
                    {
                        name: "Prüfling",
                        value: `**${prueflingName}**`,
                        inline: true
                    },
                    {
                        name: "DN",
                        value: `**${prueflingDn}**`,
                        inline: true
                    },
                    {
                        name: "Prüfung",
                        value: state.examType,
                        inline: true
                    },
                    {
                        name: "Eingetragen von",
                        value: `<@${interaction.user.id}>`,
                        inline: false
                    },
                    {
                        name: "Status",
                        value: "⏳ Wartet auf Entscheidung der Leitung",
                        inline: false
                    }
                )
                .setFooter({ text: `LSMD Ausbildungssystem • Antrag #${requestId}` })
                .setTimestamp();

            const decisionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`spontan_request_approve_${requestId}`)
                    .setLabel("Genehmigen")
                    .setEmoji("✅")
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId(`spontan_request_reject_${requestId}`)
                    .setLabel("Ablehnen")
                    .setEmoji("❌")
                    .setStyle(ButtonStyle.Danger)
            );

            const requestMessage = await interaction.channel.send({
                embeds: [embed],
                components: [decisionRow],
                allowedMentions: {
                    parse: []
                }
            });

try {
    if (state.panelChannelId && state.panelMessageId) {
        const panelChannel = await botClient.channels.fetch(state.panelChannelId);
        const panelMessage = await panelChannel.messages.fetch(state.panelMessageId);

        await panelMessage.edit({
            content: "",
            embeds: [EmbedBuilder.from(panelMessage.embeds[0])],
            components: buildSpontanePanelComponents()
        });
    }
} catch (err) {
    console.error("Spontane-Prüfungen Panel konnte nicht zurückgesetzt werden:", err);
}

            spontaneRequests.set(String(requestId), {
                requestId,
                targetName: prueflingName,
                targetDn: prueflingDn,
                examType: state.examType,
                createdBy: interaction.user.id,
                channelId: interaction.channel.id,
                messageId: requestMessage.id,
                status: "offen"
            });

            spontaneSelections.delete(adminId);

            return interaction.reply({
                content: "✅ Antrag wurde eingetragen und wartet auf Entscheidung der Leitung.",
                flags: MessageFlags.Ephemeral
            });
        }

        if (interaction.customId.startsWith("spontan_request_approve_")) {
            const requestId = interaction.customId.replace("spontan_request_approve_", "");
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
    .setTitle("✅ Spontane Prüfung genehmigt")
    .setDescription("Die Leitung hat den Antrag genehmigt.")
    .addFields(
                    {
                        name: "Prüfung",
                        value: `**${request.targetName}**`,
                        inline: true
                    },
                    {
                        name: "DN",
                        value: `**${request.targetDn}**`,
                        inline: true
                    },
                    {
                        name: "Prüfung",
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
                        value: "✅ Genehmigt",
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
            const requestId = interaction.customId.replace("spontan_request_reject_", "");
            const request = spontaneRequests.get(requestId);

            if (!request || request.status !== "offen") {
                return interaction.reply({
                    content: "Dieser Antrag wurde bereits bearbeitet oder nicht gefunden.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const modal = new ModalBuilder()
                .setCustomId(`spontan_reject_modal_${requestId}`)
                .setTitle("Spontane Prüfung ablehnen");

            const reasonInput = new TextInputBuilder()
                .setCustomId("reject_reason")
                .setLabel("Grund für die Ablehnung")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(500)
                .setPlaceholder("z.B. Voraussetzungen fehlen, Rücksprache nötig, falscher Zeitpunkt...");

            modal.addComponents(
                new ActionRowBuilder().addComponents(reasonInput)
            );

            return interaction.showModal(modal);
        }

        if (interaction.customId.startsWith("spontan_reject_modal_")) {
    const requestId = interaction.customId.replace("spontan_reject_modal_", "");
    const request = spontaneRequests.get(String(requestId));

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

    const embed = new EmbedBuilder()
        .setColor(0xef233c)
        .setTitle("❌ Spontane Prüfung abgelehnt")
        .setDescription("Die Leitung hat den Antrag abgelehnt.")
        .addFields(
            {
                name: "Prüfling",
                value: `**${request.targetName}**`,
                inline: true
            },
            {
                name: "DN",
                value: `**${request.targetDn}**`,
                inline: true
            },
            {
                name: "Prüfung",
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
                value: "❌ Abgelehnt",
                inline: false
            }
        )
        .setFooter({ text: `LSMD Ausbildungssystem • Antrag #${requestId}` })
        .setTimestamp();

    const channel = await botClient.channels.fetch(request.channelId);
    const message = await channel.messages.fetch(request.messageId);

    await message.edit({
        embeds: [embed],
        components: []
    });

    return interaction.reply({
        content: "❌ Antrag wurde abgelehnt.",
        flags: MessageFlags.Ephemeral
    });
}
    } catch (err) {
        console.error("Fehler bei Spontane-Prüfungen Interaction:", err);

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
    avatar: req.user.avatar || null,
    isViewOnly: req.user.isViewOnly || false,
    roles: req.user.roles || []
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

        return res.redirect("/dashboard");
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
    return res.redirect("/dashboard");
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
    try {
        const termine = await termineCollection
            .find({})
            .sort({ date: 1, time: 1 })
            .toArray();

        const ausbilderOptions = await getPraktiSaniAusbilderOptions();

        return res.render("termine", viewData(req, {
            active: "termine",
            termine,
            ausbilderOptions
        }));
    } catch (err) {
        console.error("Fehler beim Laden der Termine:", err);
        return res.status(500).send("Serverfehler");
    }
});

app.get("/overwatch", requireLogin, requireOverwatchOrAdmin, async (req, res) => {
    try {
        const licensesRaw = await overwatchLicensesCollection
            .find({})
            .sort({ issuedAt: -1, createdAt: -1 })
            .toArray();

        const licenses = licensesRaw.map((license) => {
            const status = getOverwatchStatus(license.issuedAt);
            const dueDate = getOverwatchDueDate(license.issuedAt);

            return {
                ...license,
                status,
                issuedAtFormatted: formatOverwatchDate(license.issuedAt),
                dueDateFormatted: formatOverwatchDate(dueDate)
            };
        });

        const stats = {
            total: licenses.length,
            green: licenses.filter(l => l.status.key === "green").length,
            yellow: licenses.filter(l => l.status.key === "yellow").length,
            red: licenses.filter(l => l.status.key === "red").length
        };

        res.render("overwatch", viewData(req, {
            active: "overwatch",
            licenses,
            stats
        }));
    } catch (err) {
        console.error("Overwatch Seite Fehler:", err);
        res.status(500).send("Overwatch Seite konnte nicht geladen werden.");
    }
});

app.post("/overwatch/create", requireLogin, requireOverwatchOrAdmin, async (req, res) => {
    try {
        const { dn, name, licenseType, issuedAt, examiner, notes } = req.body;

        if (!dn || !name || !licenseType || !issuedAt || !examiner) {
            return res.status(400).send("Bitte alle Pflichtfelder ausfüllen.");
        }

        if (!OVERWATCH_LICENSE_TYPES.includes(licenseType)) {
            return res.status(400).send("Ungültige Lizenz.");
        }

        const issuedDate = normalizeOverwatchDate(issuedAt);

        if (!issuedDate) {
            return res.status(400).send("Ungültiges Datum. Nutze YYYY-MM-DD.");
        }

        const dueDate = getOverwatchDueDate(issuedDate);

        const doc = {
            dn: dn.trim(),
            name: name.trim(),
            licenseType,
            issuedAt: issuedDate,
            dueDate,
            examiner: examiner.trim(),
            notes: notes?.trim() || "",
            source: "website",
            createdBy: req.session.user?.discordId || null,
            createdByName: req.session.user?.username || "Unbekannt",
            lastReminderAt: null,
            lastReminderDayKey: null,
            lastReminderLevel: null,
            refreshedAt: null,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const insertResult = await overwatchLicensesCollection.insertOne(doc);

        await addLog("Overwatch Lizenz über Website eingetragen", {
            id: insertResult.insertedId.toString(),
            dn: doc.dn,
            name: doc.name,
            licenseType: doc.licenseType,
            issuedAt,
            examiner: doc.examiner,
            source: "website"
        }, req.session.user);

        if (OVERWATCH_LOG_CHANNEL_ID) {
            const status = getOverwatchStatus(issuedDate);
            const logChannel = await botClient.channels.fetch(OVERWATCH_LOG_CHANNEL_ID).catch(() => null);

            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setColor(status.color)
                    .setTitle("✅ Overwatch Lizenz über Website eingetragen")
                    .setDescription("Eine neue Lizenz wurde über die Website gespeichert.")
                    .addFields(
                        {
                            name: "👤 Mitglied",
                            value: `**${doc.dn} | ${doc.name}**`,
                            inline: false
                        },
                        {
                            name: "👁️ Lizenz",
                            value: `**${doc.licenseType}**`,
                            inline: true
                        },
                        {
                            name: "📅 Seit",
                            value: `**${formatOverwatchDate(doc.issuedAt)}**`,
                            inline: true
                        },
                        {
                            name: "⏰ Fällig ab",
                            value: `**${formatOverwatchDate(doc.dueDate)}**`,
                            inline: true
                        },
                        {
                            name: "📌 Status",
                            value: `${status.emoji} **${status.label}**`,
                            inline: true
                        },
                        {
                            name: "👨‍🏫 Prüfer",
                            value: `**${doc.examiner}**`,
                            inline: true
                        },
                        {
                            name: "✍️ Eingetragen von",
                            value: req.session.user?.discordId
                                ? `<@${req.session.user.discordId}>`
                                : `**${req.session.user?.username || "Unbekannt"}**`,
                            inline: true
                        }
                    )
                    .setFooter({
                        text: "LSMD Overwatch-System • Website",
                        iconURL: LSMD_LOGO_URL
                    })
                    .setTimestamp();

                if (doc.notes) {
                    embed.addFields({
                        name: "📝 Notiz",
                        value: doc.notes.slice(0, 1000),
                        inline: false
                    });
                }

                await logChannel.send({
                    embeds: [embed],
                    allowedMentions: {
                        parse: []
                    }
                });
            }
        }

        return res.redirect("/overwatch");
    } catch (err) {
        console.error("Overwatch Website Eintrag Fehler:", err);
        return res.status(500).send("Overwatch Lizenz konnte nicht eingetragen werden.");
    }
});

app.post("/overwatch/:id/update", requireLogin, requireOverwatchOrAdmin, async (req, res) => {
    try {
        const licenseId = req.params.id;
        const { dn, name, licenseType, issuedAt, examiner, notes } = req.body;

        if (!dn || !name || !licenseType || !issuedAt || !examiner) {
            return res.status(400).send("Bitte alle Pflichtfelder ausfüllen.");
        }

        if (!OVERWATCH_LICENSE_TYPES.includes(licenseType)) {
            return res.status(400).send("Ungültige Lizenz.");
        }

        const license = await overwatchLicensesCollection.findOne({
            _id: new ObjectId(licenseId)
        });

        if (!license) {
            return res.status(404).send("Lizenz nicht gefunden.");
        }

        const issuedDate = normalizeOverwatchDate(issuedAt);

        if (!issuedDate) {
            return res.status(400).send("Ungültiges Datum. Nutze YYYY-MM-DD.");
        }

        const dueDate = getOverwatchDueDate(issuedDate);

        await overwatchLicensesCollection.updateOne(
            { _id: license._id },
            {
                $set: {
                    dn: dn.trim(),
                    name: name.trim(),
                    licenseType,
                    issuedAt: issuedDate,
                    dueDate,
                    examiner: examiner.trim(),
                    notes: notes?.trim() || "",
                    lastReminderAt: null,
                    lastReminderDayKey: null,
                    lastReminderLevel: null,
                    updatedAt: new Date(),
                    updatedBy: req.session.user?.discordId || null,
                    updatedByName: req.session.user?.username || "Unbekannt"
                }
            }
        );

        await addLog("Overwatch Lizenz bearbeitet", {
            id: license._id.toString(),
            dn: dn.trim(),
            name: name.trim(),
            licenseType,
            issuedAt,
            examiner: examiner.trim()
        }, req.session.user);

        if (OVERWATCH_LOG_CHANNEL_ID) {
    const logChannel = await botClient.channels.fetch(OVERWATCH_LOG_CHANNEL_ID).catch(() => null);

    if (logChannel) {
        const status = getOverwatchStatus(issuedDate);

        const embed = new EmbedBuilder()
            .setColor(0x2563eb)
            .setTitle("✏️ Overwatch Lizenz bearbeitet")
            .setDescription("Eine Overwatch-Lizenz wurde über die Website aktualisiert.")
            .addFields(
                {
                    name: "👤 Mitglied",
                    value: `**${dn.trim()} | ${name.trim()}**`,
                    inline: false
                },
                {
                    name: "👁️ Lizenz",
                    value: `**${licenseType}**`,
                    inline: true
                },
                {
                    name: "📅 Seit",
                    value: `**${formatOverwatchDate(issuedDate)}**`,
                    inline: true
                },
                {
                    name: "⏰ Fällig ab",
                    value: `**${formatOverwatchDate(dueDate)}**`,
                    inline: true
                },
                {
                    name: "📌 Status",
                    value: `${status.emoji} **${status.label}**`,
                    inline: true
                },
                {
                    name: "👨‍🏫 Prüfer",
                    value: `**${examiner.trim()}**`,
                    inline: true
                },
                {
                    name: "✍️ Bearbeitet von",
                    value: req.session.user?.discordId
                        ? `<@${req.session.user.discordId}>`
                        : `**${req.session.user?.username || "Unbekannt"}**`,
                    inline: true
                }
            )
            .setFooter({
                text: "LSMD Overwatch-System • Bearbeitung",
                iconURL: LSMD_LOGO_URL
            })
            .setTimestamp();

        if (notes && notes.trim() !== "") {
            embed.addFields({
                name: "📝 Notiz",
                value: notes.trim().slice(0, 1000),
                inline: false
            });
        }

        await logChannel.send({
            embeds: [embed],
            allowedMentions: {
                parse: []
            }
        });
    }
}

        return res.redirect("/overwatch");
    } catch (err) {
        console.error("Overwatch Lizenz bearbeiten Fehler:", err);
        return res.status(500).send("Lizenz konnte nicht bearbeitet werden.");
    }
});

app.post("/overwatch/:id/refresh", requireLogin, requireOverwatchOrAdmin, async (req, res) => {
    try {
        const licenseId = req.params.id;

        const license = await overwatchLicensesCollection.findOne({
            _id: new ObjectId(licenseId)
        });

        if (!license) {
            return res.status(404).send("Lizenz nicht gefunden.");
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const newDueDate = getOverwatchDueDate(today);

        await overwatchLicensesCollection.updateOne(
            { _id: license._id },
            {
                $set: {
                    issuedAt: today,
                    dueDate: newDueDate,
                    refreshedAt: new Date(),
                    refreshedBy: req.session.user?.discordId || null,
                    refreshedByName: req.session.user?.username || "Unbekannt",
                    lastReminderAt: null,
                    lastReminderDayKey: null,
                    lastReminderLevel: null,
                    updatedAt: new Date()
                }
            }
        );

        await addLog("Overwatch Auffrischung über Website abgeschlossen", {
            id: license._id.toString(),
            dn: license.dn,
            name: license.name,
            licenseType: license.licenseType
        }, req.session.user);

        if (OVERWATCH_REMINDER_CHANNEL_ID) {
    const reminderChannel = await botClient.channels.fetch(OVERWATCH_REMINDER_CHANNEL_ID).catch(() => null);

    if (reminderChannel) {
        const status = getOverwatchStatus(today);

        const embed = new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("✅ Overwatch Auffrischung abgeschlossen")
            .setDescription(
                `**${license.dn} | ${license.name}** wurde über die Website als aufgefrischt markiert.\n\n` +
                "Die Lizenz ist jetzt wieder gültig und wird auf der Website wieder grün angezeigt."
            )
            .addFields(
                {
                    name: "👤 Mitglied",
                    value: `**${license.dn} | ${license.name}**`,
                    inline: false
                },
                {
                    name: "👁️ Lizenz",
                    value: `**${license.licenseType}**`,
                    inline: true
                },
                {
                    name: "📅 Neues Datum",
                    value: `**${formatOverwatchDate(today)}**`,
                    inline: true
                },
                {
                    name: "⏰ Nächste Auffrischung",
                    value: `**${formatOverwatchDate(newDueDate)}**`,
                    inline: true
                },
                {
                    name: "📌 Status",
                    value: `${status.emoji} **${status.label}**`,
                    inline: true
                },
                {
                    name: "✅ Aufgefrischt von",
                    value: req.session.user?.discordId
                        ? `<@${req.session.user.discordId}>`
                        : `**${req.session.user?.username || "Unbekannt"}**`,
                    inline: true
                }
            )
            .setFooter({
                text: "LSMD Overwatch-System • Website Auffrischung",
                iconURL: LSMD_LOGO_URL
            })
            .setTimestamp();

        await reminderChannel.send({
            embeds: [embed],
            allowedMentions: {
                parse: []
            }
        });
    }
}

if (OVERWATCH_LOG_CHANNEL_ID) {
    const logChannel = await botClient.channels.fetch(OVERWATCH_LOG_CHANNEL_ID).catch(() => null);

    if (logChannel) {
        const status = getOverwatchStatus(today);

        const logEmbed = new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("✅ Overwatch Auffrischung über Website")
            .setDescription("Eine Lizenz wurde über die Website aufgefrischt.")
            .addFields(
                {
                    name: "👤 Mitglied",
                    value: `**${license.dn} | ${license.name}**`,
                    inline: false
                },
                {
                    name: "👁️ Lizenz",
                    value: `**${license.licenseType}**`,
                    inline: true
                },
                {
                    name: "📅 Neues Datum",
                    value: `**${formatOverwatchDate(today)}**`,
                    inline: true
                },
                {
                    name: "📌 Status",
                    value: `${status.emoji} **${status.label}**`,
                    inline: true
                },
                {
                    name: "✅ Aufgefrischt von",
                    value: req.session.user?.discordId
                        ? `<@${req.session.user.discordId}>`
                        : `**${req.session.user?.username || "Unbekannt"}**`,
                    inline: true
                }
            )
            .setFooter({
                text: "LSMD Overwatch-System • Logs",
                iconURL: LSMD_LOGO_URL
            })
            .setTimestamp();

        await logChannel.send({
            embeds: [logEmbed],
            allowedMentions: {
                parse: []
            }
        });
    }
}      

        return res.redirect("/overwatch");
    } catch (err) {
        console.error("Overwatch Website Auffrischung Fehler:", err);
        return res.status(500).send("Auffrischung konnte nicht gespeichert werden.");
    }
});

app.post("/overwatch/:id/delete", requireLogin, requireAdmin, async (req, res) => {
    try {
        const licenseId = req.params.id;

        const licenseBeforeDelete = await overwatchLicensesCollection.findOne({
        _id: new ObjectId(req.params.id)
        });

        const license = await overwatchLicensesCollection.findOne({
            _id: new ObjectId(licenseId)
        });

        if (!license) {
            return res.status(404).send("Lizenz nicht gefunden.");
        }

        await overwatchLicensesCollection.deleteOne({
            _id: license._id
        });

if (licenseBeforeDelete && OVERWATCH_LOG_CHANNEL_ID) {
    const logChannel = await botClient.channels.fetch(OVERWATCH_LOG_CHANNEL_ID).catch(() => null);

    if (logChannel) {
        const embed = new EmbedBuilder()
            .setColor(0xef233c)
            .setTitle("🗑️ Overwatch Lizenz gelöscht")
            .setDescription("Eine Overwatch-Lizenz wurde von der Website gelöscht.")
            .addFields(
                {
                    name: "👤 Mitglied",
                    value: `**${licenseBeforeDelete.dn || "-"} | ${licenseBeforeDelete.name || "-"}**`,
                    inline: false
                },
                {
                    name: "👁️ Lizenz",
                    value: `**${licenseBeforeDelete.licenseType || "-"}**`,
                    inline: true
                },
                {
                    name: "📅 Lizenz seit",
                    value: `**${formatOverwatchDate(licenseBeforeDelete.issuedAt)}**`,
                    inline: true
                },
                {
                    name: "🗑️ Gelöscht von",
                    value: `**${req.session.user?.username || "Unbekannt"}**`,
                    inline: false
                }
            )
            .setFooter({
                text: "LSMD Overwatch-System • Löschung",
                iconURL: LSMD_LOGO_URL
            })
            .setTimestamp();

        await logChannel.send({
            embeds: [embed],
            allowedMentions: {
                parse: []
            }
        });
    }
}

        await addLog("Overwatch Lizenz gelöscht", {
            id: license._id.toString(),
            dn: license.dn,
            name: license.name,
            licenseType: license.licenseType
        }, req.session.user);

        return res.redirect("/overwatch");
    } catch (err) {
        console.error("Overwatch Lizenz löschen Fehler:", err);
        return res.status(500).send("Lizenz konnte nicht gelöscht werden.");
    }
});

app.get("/dokumente", requireLogin, async (req, res) => {
    const docs = await docsCollection.find({}).sort({ createdAt: -1 }).toArray();

    res.render("dokumente", viewData(req, {
        active: "dokumente",
        docs
    }));
});

app.get("/regelwerk", requireLogin, async (req, res) => {
    res.render("regelwerk", viewData(req, {
        active: "regelwerk"
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

    await addLog("Spontane Prüfungen Panel gesendet", {
        channelId: process.env.SPONTANE_PRUEFUNGEN_CHANNEL_ID
    }, req.session.user);

    res.redirect("/admin");
});

app.post("/admin/regelwerk-embed", requireLogin, requireAdmin, async (req, res) => {
    try {
        const ok = await sendRegelwerkWebhook();

        if (!ok) {
            return res.status(500).send("Regelwerk Embed konnte nicht gesendet werden.");
        }

        await addLog("Regelwerk Embed gesendet", {
            channel: "regelwerk"
        }, req.session.user);

        return res.redirect("/admin");
    } catch (err) {
        console.error("Regelwerk Embed Fehler:", err);
        return res.status(500).send("Regelwerk Embed Fehler.");
    }
});

app.post("/admin/overwatch-panel", requireLogin, requireAdmin, async (req, res) => {
    try {
        const ok = await sendOverwatchPanel();

        if (!ok) {
            return res.status(500).send("Overwatch-Panel konnte nicht gesendet werden. Prüfe OVERWATCH_PANEL_CHANNEL_ID.");
        }

        await addLog("Overwatch-Panel gesendet", {
            channelId: OVERWATCH_PANEL_CHANNEL_ID
        }, req.session.user);

        return res.redirect("/admin");
    } catch (err) {
        console.error("Overwatch-Panel Fehler:", err);
        return res.status(500).send("Overwatch-Panel Fehler.");
    }
});

app.post("/admin/attest-panel", requireLogin, requireAdmin, async (req, res) => {
    try {
        const ok = await sendAttestPanel();

        if (!ok) {
            return res.status(500).send("Attest-Panel konnte nicht gesendet werden. Prüfe ATTEST_PANEL_CHANNEL_ID.");
        }

        await addLog("Attest-Panel gesendet", {
            channelId: process.env.ATTEST_PANEL_CHANNEL_ID
        }, req.session.user);

        return res.redirect("/admin");
    } catch (err) {
        console.error("Attest-Panel Fehler:", err);
        return res.status(500).send("Attest-Panel konnte nicht gesendet werden.");
    }
});

app.post("/admin/bewerbungs-panel", requireLogin, requireAdmin, async (req, res) => {
    await sendBewerbungsPanel();

    await addLog("Bewerbungs-Panel gesendet", {
        channelId: BEWERBUNG_CHANNEL_ID
    }, req.session.user);

    res.redirect("/admin");
});

app.post("/admin/email-panel", requireLogin, requireAdmin, async (req, res) => {
    try {
        const ok = await sendEmailPanel();

        if (!ok) {
            return res.status(500).send("E-Mail Panel konnte nicht gesendet werden. Prüfe EMAIL_PANEL_CHANNEL_ID.");
        }

        await addLog("E-Mail Panel gesendet", {
            channelId: process.env.EMAIL_PANEL_CHANNEL_ID
        }, req.session.user);

        return res.redirect("/admin");
    } catch (err) {
        console.error("E-Mail Panel Fehler:", err);
        return res.status(500).send("E-Mail Panel konnte nicht gesendet werden.");
    }
});

app.post("/admin/teamliste", requireLogin, requireAdmin, async (req, res) => {
    try {
        await updateTeamListMessage();
        return res.redirect("/admin");
    } catch (err) {
        console.error("Teamliste konnte nicht gesendet werden:", err);
        return res.status(500).send("Teamliste konnte nicht gesendet werden.");
    }
});

app.post("/admin/therapeuten-teamliste", requireLogin, requireAdmin, async (req, res) => {
    try {
        await updateTherapeutenTeamListMessage();
        return res.redirect("/admin");
    } catch (err) {
        console.error("Therapeuten-Teamliste konnte nicht gesendet werden:", err);
        return res.status(500).send("Therapeuten-Teamliste konnte nicht gesendet werden.");
    }
});

app.post("/admin/professoren-teamliste", requireLogin, requireAdmin, async (req, res) => {
    try {
        await updateProfessorenTeamListMessage();
        return res.redirect("/admin");
    } catch (err) {
        console.error("Professoren-Teamliste konnte nicht gesendet werden:", err);
        return res.status(500).send("Professoren-Teamliste konnte nicht gesendet werden.");
    }
});

app.post("/admin/einstellungsbonus-panel", requireLogin, requireAdmin, async (req, res) => {
    try {
        await sendEinstellungsBonusPanel();
        return res.redirect("/admin");
    } catch (err) {
        console.error("Einstellungsbonus-Panel konnte nicht gesendet werden:", err);
        return res.status(500).send("Einstellungsbonus-Panel konnte nicht gesendet werden.");
    }
});

app.post("/admin/wochen-reset", requireLogin, requireAdmin, async (req, res) => {
    try {
        const pointsResult = await pointsCollection.updateMany(
            {},
            {
                $set: {
                    points: 0,
                    updatedAt: new Date()
                }
            }
        );

        const bonusResult = await einstellungsBonusCollection.updateMany(
            {
                status: "ausgezahlt"
            },
            {
                $set: {
                    status: "reset",
                    resetAt: new Date(),
                    resetBy: req.session.user?.discordId || null,
                    updatedAt: new Date()
                }
            }
        );

        pointsListCache = null;
        pointsListCacheTime = 0;

        await addLog("Wochenreset durchgeführt", {
            title: "Punkte und Einstellungsbonus wurden zurückgesetzt",
            affectedUsers: pointsResult.modifiedCount,
            affectedBonusEntries: bonusResult.modifiedCount
        }, req.session.user);

        return res.redirect("/admin");
    } catch (err) {
        console.error("Wochenreset Fehler:", err);
        return res.status(500).send("Wochenreset konnte nicht durchgeführt werden.");
    }
});

app.post("/admin/abmeldung-panel", requireLogin, requireAdmin, async (req, res) => {
    try {
        await sendAbmeldungPanel();
        return res.redirect("/admin");
    } catch (err) {
        console.error("Abmeldungs-Panel konnte nicht gesendet werden:", err);
        return res.status(500).send("Abmeldungs-Panel konnte nicht gesendet werden.");
    }
});

app.post("/admin/dokumente-webhook", requireLogin, requireAdmin, async (req, res) => {
    try {
        const ok = await sendDokumenteWebhook();

        if (!ok) {
            return res.status(500).send("Dokumente Webhook konnte nicht gesendet werden.");
        }

        await addLog("Dokumente Webhook gesendet", {
            channel: "dokumente"
        }, req.session.user);

        return res.redirect("/admin");
    } catch (err) {
        console.error("Dokumente Webhook Fehler:", err);
        return res.status(500).send("Dokumente Webhook konnte nicht gesendet werden.");
    }
});

app.post("/admin/professoren-dokumente-webhook", requireLogin, requireAdmin, async (req, res) => {
    try {
        const ok = await sendProfessorenDokumenteWebhook();

        if (!ok) {
            return res.status(500).send("Professoren Dokumente Webhook konnte nicht gesendet werden.");
        }

        await addLog("Professoren Dokumente Webhook gesendet", {
            channel: "professoren-dokumente"
        }, req.session.user);

        return res.redirect("/admin");
    } catch (err) {
        console.error("Professoren Dokumente Webhook Fehler:", err);
        return res.status(500).send("Professoren Dokumente Webhook konnte nicht gesendet werden.");
    }
});

app.post("/admin/wochen-reset", requireLogin, requireAdmin, async (req, res) => {
    try {
        const result = await pointsCollection.updateMany(
            {},
            {
                $set: {
                    points: 0,
                    updatedAt: new Date()
                }
            }
        );

        pointsListCache = null;
        pointsListCacheTime = 0;

        await addLog("Wochenreset durchgeführt", {
            amount: 0,
            affectedUsers: result.modifiedCount,
            title: "Alle Punkte wurden auf 0 gesetzt"
        }, req.session.user);

        return res.redirect("/admin");
    } catch (err) {
        console.error("Wochenreset Fehler:", err);
        return res.status(500).send("Wochenreset konnte nicht durchgeführt werden.");
    }
});

function buildSpontanePanelComponents() {
    const resetId = Date.now();

    const typeRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`spontan_type_${resetId}`)
            .setPlaceholder("Prüfungsart auswählen")
            .addOptions(
                {
                    label: "Sanitäter Prüfung",
                    value: "Sanitäter Prüfung",
                    emoji: "🚑"
                }
            )
    );

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("spontan_submit")
            .setLabel("Antrag erstellen")
            .setEmoji("📝")
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

app.post("/termine/create", requireLogin, requireAusbilderOrAdmin, async (req, res) => {
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

        const insertResult = await termineCollection.insertOne({
    name,
    discordId: "",
    examType,
    date,
    time,
    examiner,
    status: "Offen",
    notes,
    source: "termine",
    createdBy: req.session.user?.discordId || null,
    createdByName: req.session.user?.username || "Unbekannt",
    createdAt: new Date()
});

const discordOk = await sendAusbildungsterminDiscordEmbed({
    id: insertResult.insertedId.toString(),
    name,
    examType,
    date,
    time,
    examiner,
    notes,
    createdById: req.session.user?.discordId || null,
    createdByName: req.session.user?.username || "Unbekannt"
});

console.log("Ausbildung Discord gesendet:", discordOk);

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
    einstellungsBonusCollection = db.collection("einstellungsBonus");
    overwatchLicensesCollection = db.collection("overwatchLicenses");

    await pointsCollection.createIndex({ points: -1 });
    await pointsCollection.createIndex({ userId: 1 });

    await termineCollection.createIndex({ date: 1, time: 1 });
    await termineCollection.createIndex({ createdAt: -1 });

    await docsCollection.createIndex({ createdAt: -1 });

    await logsCollection.createIndex({ createdAt: -1 });
    await einstellungsBonusCollection.createIndex({ ausbilderDiscordId: 1, status: 1 });
    await einstellungsBonusCollection.createIndex({ createdAt: -1 });

    if (process.env.DISCORD_BOT_TOKEN) {
        botClient.login(process.env.DISCORD_BOT_TOKEN)
    .then(() => {
        console.log("Discord Bot ist online");
        startWeeklyBonusAnnouncementWatcher();
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





