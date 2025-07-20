require("dotenv").config();
const { Telegraf, session, Markup } = require("telegraf");
const fetch = require("node-fetch");

// === Инициализация ===
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);
bot.use(session());

// === Константы для welcome ===
const WELCOME_PHOTO =
  "https://i.pinimg.com/736x/36/22/37/362237c342b77a2b0c5edf8893f0e347.jpg";

// функция отправки welcome экрана
function sendWelcome(ctx) {
  ctx.session = {};
  return ctx.replyWithPhoto(
    { url: WELCOME_PHOTO },
    {
      caption: `
*Что умеет этот бот?*
Калькулятор для подсчёта стоимости заказа из Германии 🇩🇪

• Рассчитывает цену товара + комиссию  
• Учитывает текущий курс евро  
• Поддерживает вопросы через /ask  

Нажмите ▶️ «Начать расчёт», чтобы продолжить`,
      parse_mode: "Markdown",
      reply_markup: Markup.keyboard([["▶️ Начать расчёт"]])
        .oneTime()
        .resize(),
    }
  );
}

// === Настройки ===
const COMMISSION = 1.3; // 30%
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 минут

// === Хранилище вопросов ===
const pendingQuestions = new Map();

// === Получение курса евро ===
async function getRate() {
  try {
    const res = await fetch("https://www.cbr-xml-daily.ru/daily_json.js");
    const json = await res.json();
    return json.Valute.EUR.Value;
  } catch {
    return 100;
  }
}

// === Middleware: авто‑сброс сессии по таймауту ===
bot.use((ctx, next) => {
  const now = Date.now();
  if (!ctx.session) ctx.session = {};
  if (ctx.session.last && now - ctx.session.last > SESSION_TIMEOUT) {
    ctx.session = {};
  }
  ctx.session.last = now;
  return next();
});

// === Лог входящих сообщений ===
bot.use((ctx, next) => {
  if (ctx.message?.text) {
    console.log(
      `🕒 [${new Date().toISOString()}] ${ctx.from.username || ctx.from.id}: "${
        ctx.message.text
      }"`
    );
  }
  return next();
});

// === Перехват ответов менеджера ===
bot.on("message", async (ctx, next) => {
  const replyTo = ctx.message.reply_to_message;
  if (
    ctx.chat.id === ADMIN_ID &&
    replyTo &&
    pendingQuestions.has(replyTo.message_id)
  ) {
    const userId = pendingQuestions.get(replyTo.message_id);
    const answer = ctx.message.text;
    await ctx.telegram.sendMessage(userId, `💬 Ответ менеджера:\n\n${answer}`);
    console.log(`✍️ [ANSWER] to ${userId}: "${answer}"`);
    pendingQuestions.delete(replyTo.message_id);
    return ctx.reply("✅ Ответ отправлен пользователю.");
  }
  return next();
});

// === /ask — задаём вопрос менеджеру ===
bot.command("ask", (ctx) => {
  ctx.session = { mode: "ask" };
  return ctx.reply("Напишите свой вопрос, я передам его менеджеру.");
});

// === /welcome — показать welcome экран ===
bot.command("welcome", (ctx) => sendWelcome(ctx));

// === /start — перевод в режим расчёта ===
bot.start((ctx) => {
  ctx.session = { mode: "calc" };
  return ctx.reply(
    "Привет! Я помогу тебе рассчитать стоимость заказа из Германии 🇩🇪\n\n" +
      "Пожалуйста, введи сумму заказа в евро."
  );
});

// === /rate — показать курс евро ===
bot.command("rate", async (ctx) => {
  const rate = await getRate();
  return ctx.reply(`Текущий курс евро: *${rate.toFixed(2)}* ₽/€`, {
    parse_mode: "Markdown",
  });
});

// === /info — условия заказа ===
bot.command("info", (ctx) => {
  return ctx.reply(
    `🧾 *Условия заказа:* \n` +
      `• Комиссия 30% (доставка до Краснодара включена)\n` +
      `• Крупные заказы — доплата 1000 ₽/кг\n` +
      `• Курс из ЦБ РФ`,
    { parse_mode: "Markdown" }
  );
});

// === /help — меню команд ===
bot.command("help", (ctx) => {
  return ctx.reply(
    `/start — начать расчёт\n` +
      `/rate  — узнать курс евро\n` +
      `/info  — условия заказа\n` +
      `/ask   — задать вопрос менеджеру\n` +
      `/help  — показать это сообщение`
  );
});

// === /faq — Часто задаваемые вопросы ===
bot.command("faq", (ctx) => {
  return ctx.replyWithMarkdown(`
❓ *Часто задаваемые вопросы (FAQ)*

1. 💶 *Как рассчитать стоимость заказа?*
Отправьте цену товара в € — бот рассчитает итоговую сумму в ₽ с учётом комиссии.

2. 📦 *Что входит в комиссию 30%?*
• выкуп  
• доставка по Германии  
• пересылка в Россию (если до 1 кг)  
• сопровождение

3. 🚚 *Когда доставка оплачивается отдельно?*
Если вес заказа более 1 кг (обувь, техника и т.п.), действует доплата — 11 € за каждый кг.

4. ⏳ *Сколько ждать заказ?*
Обычно 2–4 недели. Мы сопровождаем заказ на каждом этапе.

5. 💬 *Где можно заказать?*
Пиши 👉 менеджеру свой никнейм-с тобой свяжутся или начни расчёт прямо здесь.

6. 🔁 *Можно ли вернуть товар?*
Нет. Сервис — посредник. Возвраты и обмены невозможны. Проверяйте всё заранее.

7. 🛒 *С каких сайтов можно заказать?*
С любых, где доставка по Германии. Смотри пост с рекомендованными магазинами в канале.

8. 🧾 *Как проходит оплата?*
100% перед выкупом. Сумма фиксируется после расчёта. Перевод — на карту.

9. 📍 *Какой курс используется?*
Актуальный курс евро ЦБ РФ на день оплаты.
  `);
});

// === Основная логика ===
bot.on("text", async (ctx) => {
  const txt = ctx.message.text.trim().replace(",", ".");

  // режим “ask”
  if (ctx.session.mode === "ask") {
    const forwarded = await ctx.forwardMessage(
      ADMIN_ID,
      ctx.chat.id,
      ctx.message.message_id
    );
    pendingQuestions.set(forwarded.message_id, ctx.chat.id);
    console.log(
      `✉️ [ASK] From ${ctx.chat.id} → forwarded id ${forwarded.message_id}`
    );
    await ctx.reply(
      "Спасибо! Ваш вопрос отправлен менеджеру — ожидайте ответ."
    );
    ctx.session = {};
    return;
  }

  // режим “calc” — сразу считаем по введённой сумме
  if (ctx.session.mode === "calc") {
    const amount = parseFloat(txt);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply("Введите корректную сумму в евро.");
    }

    const rate = await getRate();
    const total = Math.round(amount * rate * COMMISSION);
    console.log(
      `🧮 [CALC] User ${
        ctx.chat.id
      }: ${amount}€ → ${total}₽ (rate=${rate.toFixed(2)})`
    );

    await ctx.reply(
      `📦 Сумма: ${amount} €\n` +
        `💶 Курс: ${rate.toFixed(2)} ₽/€\n` +
        `➡️ Итого: ${total.toLocaleString("ru-RU")} ₽\n\n` +
        `✅ Доставка до Краснодара включена.\n` +
        `⚠️ Для крупногабаритных или тяжелых заказов возможна доплата 1000 ₽/кг.`
    );

    ctx.session = {};
    return;
  }

  // если ничто не активно
  return ctx.reply(
    "Введите /start для расчёта или /ask для вопроса менеджеру.\n" +
      "Список команд — /help"
  );
});

// === Запуск polling ===
(async () => {
  await bot.telegram.deleteWebhook(); // на всякий чистим
  await bot.launch({ dropPendingUpdates: true }); // запускаем polling
  console.log("🚀 Бот запущен (polling, очищены старые апдейты)");
})();

// === HTTP‑сервер, чтобы Render Web Service держал процесс живым ===
const http = require("http");
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => res.writeHead(200).end("OK"))
  .listen(PORT, () => {
    console.log(`🌐 HTTP‑сервер запущен и слушает порт ${PORT}`);
  });

// === Меню команд ===
(async () => {
  await bot.telegram.setMyCommands([
    { command: "start", description: "Начать расчёт" },
    { command: "rate", description: "Узнать курс" },
    { command: "info", description: "Условия заказа" },
    { command: "ask", description: "Задать вопрос" },
    { command: "help", description: "Помощь" },
    { command: "ask", description: "Задать вопрос" },
  ]);
})();

// === Обработка ошибок ===
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);
