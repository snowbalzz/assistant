import OpenAI from "openai";
import dotenv from "dotenv";
import express from "express";

// Setup
const app = express();
app.use(express.json());
let pollingInterval;
const openai = new OpenAI({
  apiKey: process.env[dotenv.config().parsed.OPENAI_API_KEY],
});

// Utils
function logger(msg) {
  console.log(
    `${new Date().toLocaleTimeString("en-US", {
      hour12: false,
    })} - [ ${msg} ]`,
  );
}

function sanitize(string) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
    "/": "&#x2F;",
  };
  const reg = /[&<>"'/]/gi;
  return string.replace(reg, (match) => map[match]);
}

// Session API Functions
async function createSession(topic) {
  let assistantObject = {
    instructions:
      "You are an AI Study Leader named Daan-GPT. Guide students during study sessions without providing direct answers. Your topic is [insert topic] ",
    name: "Daan-GPT",
    tools: [{ type: "code_interpreter" }],
    model: "gpt-4",
  };
  if (topic) {
    assistantObject.instructions = assistantObject.instructions.replace(
      "[insert topic]",
      sanitize(topic),
      // topic,
    );
  } else {
    throw new Error("Topic is required to create a session!");
  }
  const myAssistant = await openai.beta.assistants.create(assistantObject);
  return myAssistant;
}

async function deleteAssistantSession(assistanId) {
  logger(`Deleting assistant session`);
  const response = await openai.beta.assistants.del(assistanId);
  return response;
}

async function createThreadSession() {
  logger(`Creating thread session`);
  const thread = await openai.beta.threads.create();
  return thread;
}

async function deleteThreadSession(threadId) {
  logger(`Deleting thread session`);
  const response = await openai.beta.threads.del(threadId);
  return response;
}

async function retriveThreadMesseges(threadId) {
  logger(`Retriving messeges of Thread - ${threadId}`);
  const response = await openai.beta.threads.messages.list(threadId);
  return response;
}

async function runAssistant(threadId, assistantId) {
  logger(`Running assistant`);
  const response = await openai.beta.threads.runs.create(threadId, {
    assistant_id: assistantId,
  });
  return response;
}

async function addMessage(threadId, message) {
  logger(`Adding message: ${message}`);
  const response = await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: message,
  });
  return response;
}

async function checkingStatus(res, threadId, runId) {
  const runObject = await openai.beta.threads.runs.retrieve(threadId, runId);
  const status = runObject.status;
  logger(
    `Checking status: ${status === "completed" ? "Completed" : "Thinking"}`,
  );
  if (status == "completed") {
    clearInterval(pollingInterval);
    const messagesList = await openai.beta.threads.messages.list(threadId);
    const messages = messagesList.data.map((message) => message.content);
    res.json({
      question: messages[1],
      answer: messages[0],
      messages: messages,
    });
  }
}

// Session Endpoints
app.get("/session/:id/thread/:id2", (req, res) => {
  const assistantId = req.params.id;
  const threadId = req.params.id2;
  retriveThreadMesseges(threadId)
    .then((messages) => {
      res.json(messages);
    })
    .catch((error) => {
      logger(`Unable to retrieve messages for thread ${threadId}`);
      res.status(500).json({ error: "Unable to retrieve messages for thread" });
    });
});

app.post("/session", (req, res) => {
  createSession(req.body.topic).then((assistant) => {
    createThreadSession().then((thread) => {
      res.json({
        threadId: thread.id,
        assistantId: assistant.id,
        url:
          dotenv.config().parsed.PROJECT_URL +
          "/session/" +
          assistant.id +
          "/thread/" +
          thread.id,
      });
    });
  });
});

app.post("/session/:id/thread/:id2", (req, res) => {
  const { message } = req.body;
  const assistantId = req.params.id;
  const threadId = req.params.id2;
  addMessage(threadId, message)
    .then((message) => {
      runAssistant(threadId, assistantId)
        .then((run) => {
          const runId = run.id;
          pollingInterval = setInterval(() => {
            checkingStatus(res, threadId, runId);
          }, 5000);
        })
        .catch((error) => {
          logger(`Unable to run assistant`);
          res.status(500).json({ error: "Unable to run assistant" });
        });
    })
    .catch((error) => {
      logger(`Unable to add message: ${message}`);
      res.status(500).json({ error: "Unable to add message" });
    });
});

app.delete("/session/:id/thread/:id2", (req, res) => {
  const assistantId = req.params.id;
  const threadId = req.params.id2;
  deleteThreadSession(threadId)
    .then((result) => {
      if (result.deleted) {
        deleteAssistantSession(assistantId)
          .then((result) => {
            logger(`Thread ${threadId} and Assistant ${assistantId} deleted`);
            res.json({ message: "Thread and Assistant deleted" });
          })
          .catch((error) => {
            logger(`Unable to delete assistant ${assistantId}`);
            res.status(500).json({ error: "Unable to delete assistant" });
          });
      }
    })
    .catch((error) => {
      logger(
        `Unable to delete thread ${threadId} and assistant ${assistantId}`,
      );
      res.status(500).json({ error: "Unable to delete thread and assistant" });
    });
});

app.listen(3000, () => {
  logger("Server is running on port 3000");
});
