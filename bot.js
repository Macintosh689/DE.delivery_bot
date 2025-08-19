require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const fetch = require("node-fetch");
const LocalSession = require("telegraf-session-local");

// === Инициализация ===
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);
bot.use(new LocalSession({ database: "session.json" }).middleware());

// === Константы ===
const WELCOME_PHOTO =
  "https://i.pinimg.com/736x/36/22/37/362237c342b77a2b0c5edf8893f0e347.jpg";
const COMMISSION = 1.3;
const SESSION_TIMEOUT = 10 * 60 * 1000;
const pendingQuestions = new Map();

// === Главное меню ===
const mainMenu = Markup.keyboard([
  ["▶️ Начать расчёт"],
  ["📈 Курс евро", "🧾 Условия заказа"],
  ["❓ FAQ", "💬 Задать вопрос"],
  ["❌ Скрыть меню"],
]).resize();

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

// === Middleware: лог + очистка режима по таймауту ===
bot.use((ctx, next) => {
  const now = Date.now();
  if (!ctx.session) ctx.session = {};
  if (ctx.session.last && now - ctx.session.last > SESSION_TIMEOUT) {
    ctx.session.mode = null;
  }
  ctx.session.last = now;

  if (ctx.message?.text) {
    console.log(
      `🕒 [${new Date().toISOString()}] ${ctx.from.username || ctx.from.id}: "${
        ctx.message.text
      }"`
    );
  }
  return next();
});

// === Приветствие ===
bot.start((ctx) => {
  ctx.session.mode = null;
  return ctx.replyWithPhoto(
    { url: WELCOME_PHOTO },
    {
      caption: `*Что умеет этот бот?*
Калькулятор для подсчёта стоимости заказа из Германии 🇩🇪

• Рассчитывает цену товара + комиссию  
• Учитывает текущий курс евро  
• Поддерживает вопросы через "💬 Задать вопрос"`,
      parse_mode: "Markdown",
      reply_markup: mainMenu.reply_markup,
    }
  );
});

// === Команда показать меню ===
bot.command("menu", (ctx) => {
  ctx.session.mode = null;
  return ctx.reply("Выберите действие из меню 👇", mainMenu);
});

// Скрыть меню кнопкой
bot.hears("❌ Скрыть меню", (ctx) => {
  return ctx.reply(
    "Меню скрыто 👌 Напишите /menu, чтобы открыть снова.",
    Markup.removeKeyboard()
  );
});

// Скрыть меню командой
bot.command("hide", (ctx) => {
  return ctx.reply(
    "Меню скрыто 👌 Напишите /menu, чтобы открыть снова.",
    Markup.removeKeyboard()
  );
});

// === FAQ ===
const faqText = `
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
Обычно 3–5 недель. Мы сопровождаем заказ на каждом этапе.

5. 💬 *Как можно заказать?*
Сохрани ссылку нужного товара и пришли её [менеджеру](https://t.me/Kk\_Fedor).

6. 🔁 *Можно ли вернуть товар?*
Нет. Сервис — посредник. Возвраты и обмены невозможны. Проверяйте всё заранее.

7. 🛒 *С каких сайтов можно заказать?*
С любых, где доставка по Германии. Смотри пост с рекомендованными магазинами в канале.

8. 🧾 *Как проходит оплата?*
100% перед выкупом. Сумма фиксируется после расчёта. Перевод — на карту.

9. 📍 *Какой курс используется?*
Актуальный курс евро ЦБ РФ на день оплаты.
`;

// === Обработка кнопок ===
bot.hears("📈 Курс евро", async (ctx) => {
  const rate = await getRate();
  return ctx.reply(`Текущий курс евро: *${rate.toFixed(2)}* ₽/€`, {
    parse_mode: "Markdown",
  });
});

bot.hears("🧾 Условия заказа", (ctx) => {
  return ctx.reply(
    `🧾 *Условия заказа:* \n• Комиссия 30% (доставка до Краснодара включена)\n• Заказы весом более 1кг — доплата 11€/кг\n• Курс из ЦБ РФ`,
    { parse_mode: "Markdown" }
  );
});

bot.hears("❓ FAQ", (ctx) => {
  ctx.reply(faqText, {
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
  });
});

bot.hears("💬 Задать вопрос", (ctx) => {
  ctx.session.mode = "ask";
  return ctx.reply("Напишите свой вопрос — я передам его менеджеру.");
});

bot.hears("▶️ Начать расчёт", (ctx) => {
  ctx.session.mode = "calc";
  return ctx.reply("Введи сумму заказа в евро:");
});

// === Ответы менеджера ===
bot.on("message", async (ctx, next) => {
  const replyTo = ctx.message.reply_to_message;
  if (
    ctx.chat.id === ADMIN_ID &&
    replyTo &&
    pendingQuestions.has(replyTo.message_id)
  ) {
    const userId = pendingQuestions.get(replyTo.message_id);
    await ctx.telegram.sendMessage(
      userId,
      `💬 Ответ менеджера:\n\n${ctx.message.text}`
    );
    pendingQuestions.delete(replyTo.message_id);
    return ctx.reply("Ответ отправлен пользователю ✅");
  }
  return next();
});

// === Основной текстовый хендлер ===
bot.on("text", async (ctx) => {
  const txt = ctx.message.text.trim().replace(",", ".");

  if (ctx.session.mode === "ask") {
    const forwarded = await ctx.forwardMessage(
      ADMIN_ID,
      ctx.chat.id,
      ctx.message.message_id
    );
    pendingQuestions.set(forwarded.message_id, ctx.chat.id);
    await ctx.reply(
      "✅ Ваш вопрос передан менеджеру. Ожидайте ответ.",
      mainMenu
    );
    ctx.session.mode = null;
    return;
  }

  if (ctx.session.mode === "calc") {
    const amount = parseFloat(txt);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply("Введите корректную сумму в евро.", mainMenu);
    }
    const rate = await getRate();
    const total = Math.round(amount * rate * COMMISSION);
    await ctx.reply(
      `📦 Сумма: ${amount} €\n💶 Курс: ${rate.toFixed(
        2
      )} ₽/€\n➡️ Итого: ${total.toLocaleString(
        "ru-RU"
      )} ₽\n\n✅ Доставка до Краснодара включена.\n⚠️ Возможна доплата 11€/кг при габаритных заказах.`,
      mainMenu
    );
    return;
  }

  return ctx.reply("Выберите действие из меню 👇", mainMenu);
});

// === Команды ===
bot.command("faq", (ctx) => ctx.replyWithMarkdown(faqText));
bot.command("rate", async (ctx) => {
  const rate = await getRate();
  ctx.reply(`Текущий курс евро: *${rate.toFixed(2)}* ₽/€`, {
    parse_mode: "Markdown",
  });
});
bot.command("terms", (ctx) =>
  ctx.reply(
    `🧾 *Условия заказа:* 
• Комиссия 30% (доставка до Краснодара включена)
• Заказы весом более 1кг — доплата 11€/кг
• Курс из ЦБ РФ`,
    { parse_mode: "Markdown" }
  )
);
bot.command("ask", (ctx) => {
  ctx.session.mode = "ask";
  ctx.reply("Напишите свой вопрос — я передам его менеджеру.");
});
bot.command("calc", (ctx) => {
  ctx.session.mode = "calc";
  ctx.reply("Введи сумму заказа в евро:");
});

// === Запуск ===
(async () => {
  await bot.telegram.deleteWebhook();
  await bot.telegram.setMyCommands([
    { command: "menu", description: "Показать меню" },
    { command: "hide", description: "Скрыть меню" },
  ]);
  await bot.launch({ dropPendingUpdates: true });
  console.log("🚀 Бот запущен (polling + local session)");
})();

// === Ошибки ===
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);
