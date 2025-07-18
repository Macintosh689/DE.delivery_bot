require("dotenv").config();
const { Telegraf } = require("telegraf");
const fetch = require("node-fetch");

const bot = new Telegraf(process.env.BOT_TOKEN);

const COMMISSION = 1.3;

async function getCurrentRate() {
  try {
    const response = await fetch("https://www.cbr-xml-daily.ru/daily_json.js");
    const data = await response.json();
    return data.Valute.EUR.Value;
  } catch (error) {
    console.error("Ошибка при получении курса:", error);
    return 100; // fallback
  }
}

bot.start((ctx) => {
  ctx.reply(
    "Привет! Я помогу тебе рассчитать примерную стоимость заказа из Германии 🇩🇪\n\n" +
      "Пожалуйста, введи стоимость товара или общую сумму заказа в евро.\n\n" +
      "Например: 150"
  );
});

bot.on("text", async (ctx) => {
  const input = ctx.message.text.trim().replace(",", ".");
  const amount = parseFloat(input);

  if (isNaN(amount)) {
    return ctx.reply(
      "Пожалуйста, введи только число — сумму заказа в евро. Например: 150"
    );
  }

  const rate = await getCurrentRate();
  const totalRub = Math.round(amount * rate * COMMISSION);

  ctx.reply(
    `📦 Сумма заказа: ${amount} €\n` +
      `💶 Текущий курс: ${rate.toFixed(2)} ₽\n` +
      `➡️ Итоговая стоимость: ${totalRub.toLocaleString("ru-RU")} ₽\n\n` +
      `⚠️ В эту сумму уже включена доставка до Краснодара.\n` +
      `❗️Если заказ крупный (6+ вещей, обувь, верхняя одежда, техника) — возможна доплата за доставку: 1000 ₽/кг.\n` +
      `Уточни у менеджера при оформлении.`
  );
});

bot.launch();
console.log("🚀 Бот запущен");

// Предотвращает выход при ошибках
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});
