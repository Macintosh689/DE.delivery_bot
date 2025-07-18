require("dotenv").config();
const { Telegraf, session } = require("telegraf");
const fetch = require("node-fetch");

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID); // из .env
bot.use(session());

// Настройки
const COMMISSION = 1.3; // 30%
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 минут

// Для хранения соответствия: forwardedMessageId → userChatId
const pendingQuestions = new Map();

// Получаем курс евро
async function getRate() {
  try {
    const res = await fetch("https://www.cbr-xml-daily.ru/daily_json.js");
    const json = await res.json();
    return json.Valute.EUR.Value;
  } catch {
    return 100;
  }
}

// Middleware: авто‑сброс по таймауту
bot.use((ctx, next) => {
  const now = Date.now();
  if (!ctx.session) ctx.session = {};
  if (ctx.session.last && now - ctx.session.last > SESSION_TIMEOUT) {
    ctx.session = {};
  }
  ctx.session.last = now;
  return next();
});

// 1) Перехват ответа менеджера — отправляем его тому пользователю, чей вопрос он отвечал
bot.on("message", async (ctx, next) => {
  const replyTo = ctx.message.reply_to_message;
  if (
    ctx.chat.id === ADMIN_ID &&
    replyTo &&
    pendingQuestions.has(replyTo.message_id)
  ) {
    const userId = pendingQuestions.get(replyTo.message_id);
    const answer = ctx.message.text;
    // шлём ответ пользователю
    await ctx.telegram.sendMessage(userId, `💬 Ответ менеджера:\n\n${answer}`);
    // уведомляем менеджера
    await ctx.reply("✅ Ответ отправлен пользователю.");
    // удаляем из очереди
    pendingQuestions.delete(replyTo.message_id);
    return;
  }
  return next();
});

// /ask — пользователь задаёт вопрос
bot.command("ask", (ctx) => {
  ctx.session = { mode: "ask" };
  return ctx.reply("Напишите свой вопрос, я передам его менеджеру.");
});

// /start — сразу переключаем в режим расчёта
bot.start((ctx) => {
  ctx.session = { mode: "calc" };
  return ctx.reply(
    "Привет! Я помогу рассчитать примерную стоимость заказа из Германии 🇩🇪\n\n" +
      "Введите сумму заказа в евро:"
  );
});

// /rate — текущий курс
bot.command("rate", async (ctx) => {
  const rate = await getRate();
  return ctx.reply(`Текущий курс евро: *${rate.toFixed(2)}* ₽/€`, {
    parse_mode: "Markdown",
  });
});

// /info — условия доставки и комиссии
bot.command("info", (ctx) => {
  return ctx.reply(
    `🧾 *Условия заказа:* \n` +
      `• Комиссия: _30%_ (включает доставку до Краснодара)\n` +
      `• Крупные заказы (6+ вещей, техника, обувь) — доплата _1000 ₽/кг_\n` +
      `• Курс берётся автоматически из ЦБ РФ\n`,
    { parse_mode: "Markdown" }
  );
});

// /help — список команд
bot.command("help", (ctx) => {
  return ctx.reply(
    `/start   — начать расчёт стоимости\n` +
      `/rate    — узнать текущий курс евро\n` +
      `/info    — условия доставки и комиссии\n` +
      `/ask     — задать вопрос менеджеру\n` +
      `/help    — показать это сообщение`
  );
});

// Основная логика: режимы ask и calc
bot.on("text", async (ctx) => {
  const txt = ctx.message.text.trim().replace(",", ".");

  // Режим «ask» — сохраняем и форвардим вопрос
  if (ctx.session.mode === "ask") {
    const forwarded = await ctx.forwardMessage(
      ADMIN_ID,
      ctx.chat.id,
      ctx.message.message_id
    );
    // запоминаем, чтобы потом ответить
    pendingQuestions.set(forwarded.message_id, ctx.chat.id);

    await ctx.reply(
      "Спасибо! Ваш вопрос отправлен менеджеру — ожидайте ответ здесь."
    );
    ctx.session = {};
    return;
  }

  // Режим «calc» — два шага: сумма → количество
  if (ctx.session.mode === "calc") {
    // шаг 1: ввод суммы
    if (!ctx.session.amount) {
      const amount = parseFloat(txt);
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply("Введите корректную сумму в евро:");
      }
      ctx.session.amount = amount;
      ctx.session.awaiting = "count";
      return ctx.reply("Теперь введите количество вещей:");
    }

    // шаг 2: ввод количества
    if (ctx.session.awaiting === "count" && !ctx.session.count) {
      const count = parseInt(txt, 10);
      if (isNaN(count) || count <= 0) {
        return ctx.reply(
          "Введите натуральное число — количество вещей, например: 3"
        );
      }
      ctx.session.count = count;

      // считаем итог
      const rate = await getRate();
      const total = Math.round(ctx.session.amount * rate * COMMISSION);
      const note =
        count <= 5
          ? "✅ Доставка до Краснодара включена."
          : "⚠️ Для крупногабаритных или тяжелых заказов возможна доплата 1000 ₽/кг.";

      await ctx.reply(
        `📦 Сумма заказа: ${ctx.session.amount} €\n` +
          `👕 Количество вещей: ${count}\n` +
          `💶 Курс: ${rate.toFixed(2)} ₽/€\n` +
          `➡️ Итого: ${total.toLocaleString("ru-RU")} ₽\n\n` +
          note
      );

      ctx.session = {};
      return;
    }
  }

  // Если ни один режим не активен
  return ctx.reply(
    "Введите /start для расчёта стоимости или /ask, чтобы задать вопрос менеджеру.\n" +
      "Для списка команд — /help"
  );
});

// Запуск
bot.launch();
console.log("🚀 Бот запущен");

// Регистрация меню команд
(async () => {
  await bot.telegram.setMyCommands([
    { command: "/start", description: "Начать расчёт стоимости" },
    { command: "/rate", description: "Узнать текущий курс евро" },
    { command: "/info", description: "Условия доставки и комиссии" },
    { command: "/ask", description: "Задать вопрос менеджеру" },
    { command: "/help", description: "Помощь по боту" },
  ]);
})();

// Защита от падений
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);
