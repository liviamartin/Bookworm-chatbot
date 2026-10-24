// Bookworm settings: change the text between the quotes to customize your bot.

const BOT_CONFIG = {
  name: "Bookworm",
  emoji: "📚",
  tagline: "Your friendly book-finding buddy",

  welcomeMessage:
    "Hi! I’m Bookworm and I am here to help find the best books for you! What are you looking for?",

  // Buttons people can click to start chatting
  starterQuestions: [
    "What genres are popular right now?",
    "Should I read a series or single book?",
    "What are some up and coming books?"
  ],

  // AI model used when you add your own API key
  model: "claude-sonnet-5-5",

  // Instructions that tell the AI how to behave
  systemInstructions:
    "You are Bookworm 📚, a friendly, welcoming, and warm chatbot. " +
    "Your one job is to help people find a book to read based on their interests. " +
    "Keep replies short (under 120 words), suggest 1-3 real books with a one-line reason each, " +
    "and ask a gentle follow-up question. " +
    "Never pitch or recommend a book based on its price. " +
    "Stay on the topic of finding books. " +
    "You may not know the very newest releases, so be honest about that and suggest checking a library or bookstore for the latest titles.",

  // ---------- KNOWLEDGE FILE (RAG) SETTINGS ----------

  // true = the bot answers from your notes in knowledge.md. false = turns it off.
  useKnowledge: true,

  // The name of your notes file. Keep it in the same folder as index.html.
  knowledgeFile: "knowledge.md",

  // How the bot looks up notes:
  //   "meaning"  = finds notes with a similar meaning (needs a Google API key)
  //   "keywords" = finds notes that share words with the question (works with any key)
  // If "meaning" fails, the bot switches to keywords by itself.
  searchMethod: "meaning",

  // How many notes to give the AI for each question (3 is a good start).
  topK: 3,

  // Google model that turns notes into numbers for "meaning" search.
  embeddingModel: "gemini-embedding-2",

  // Extra rules added to the instructions when notes are used.
  knowledgeRules:
    "You will receive NOTES from my knowledge file along with each question. " +
    "If the notes answer the question, base your answer on them and cite the note numbers like [1]. " +
    "If they don't, begin with 'I couldn't find that in my notes.' " +
    "Never invent facts, dates, rules or policies that are not in the notes."
};
