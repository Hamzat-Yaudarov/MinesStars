async function animateText(ctx, initialText, frames = [".  ", ".. ", "..."], interval = 400) {
  const sent = await ctx.reply(initialText);
  let i = 0;
  for (let t = 0; t < frames.length; t++) {
    await new Promise((res) => setTimeout(res, interval));
    try {
      await ctx.telegram.editMessageText(sent.chat.id, sent.message_id, null, initialText + " " + frames[i % frames.length]);
    } catch (e) {
      // игнорируем ошибки редактирования (сообщение могло быть удалено)
    }
    i++;
  }
  return sent;
}

module.exports = { animateText };
