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
function logger(msg, type = "info") {
  console.log(
    `[${new Date().toLocaleTimeString("en-US", {
      hour12: false,
    })}][${type.toUpperCase()}] => ${msg}`,
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
async function createSession(topic, goal, res) {
  let assistantObject = {
    instructions: `
      1. Session Management:
         -The topic of the discussion is [insert topic] and the goal is [insert goal]

      2. Guidance and Support:**
         - Provide hints, tips, and guidance to students when they face difficulties, ensuring you do not give direct answers.
         - Use a Socratic method by asking probing questions to lead students to the answer.
         - Break down complex problems into manageable parts and guide students through each part.
         - Monitor the progress of the session and ensure students are on track to meet their goals.

      3. **Subgoals and Active Engagement:**
         - Create subgoals based on the session's main objective and the time available.
         - Actively guide the session towards these subgoals at regular intervals.
         - Prompt students to take breaks as per the session plan and encourage them to stay focused during study periods.

      4. **Feedback and Adaptation:**
         - Collect feedback from students at the end of the session about their experience and your assistance.
         - Use this feedback to improve future sessions, learning from past interactions to better meet student needs.

      5. **Behavior and Interaction Style:**
         - Be supportive, patient, and encouraging in all interactions.
         - Maintain a balance between being helpful and encouraging independent problem-solving.
         - Avoid providing direct answers or solutions to assignments and exam questions.

      6. **Constraints and Limitations:**
         - Do not complete assignments or provide explicit answers to exam questions.
         - Maintain the confidentiality and privacy of the students and their work.
         - Ensure all interactions are respectful and conducive to a positive learning environment.`,
    name: "Daan-GPT",
    tools: [{ type: "code_interpreter" }],
    model: "gpt-4",
  };
  if ((topic, goal)) {
    assistantObject.instructions = assistantObject.instructions.replace(
      "[insert topic]",
      sanitize(topic),
      // topic,
      "[insert goal]",
      sanitize(goal),
      //goal
    );
  } else {
    res.status(500).json({ error: "Topic or Goal not provided!" });
  }
  const myAssistant = await openai.beta.assistants.create(assistantObject);
  return myAssistant;
}

async function deleteAssistantSession(assistanId) {
  logger(`Deleting assistant session`, "warn");
  const response = await openai.beta.assistants.del(assistanId);
  return response;
}

async function createThreadSession() {
  logger(`Creating thread session`);
  const thread = await openai.beta.threads.create();
  return thread;
}

async function deleteThreadSession(threadId) {
  logger(`Deleting thread session`, "warn");
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

async function addMessage(threadId, message, user) {
  logger(`Adding message: ${message}`);
  const response = await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: message,
    metadata: {
      user: user,
    },
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
  createSession(req.body.topic, req.body.goal, res).then((assistant) => {
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
  const { message, user } = req.body;
  const assistantId = req.params.id;
  const threadId = req.params.id2;
  addMessage(threadId, message, user)
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

const catAscii = `
 /\\_/\\
( o.o )  /MEOW! Im a VeRy AsSiStIvE aSsIsTaNt!/
 > ^ < _/
 Server is running at ${dotenv.config().parsed.PROJECT_URL}
`;

app.listen(3000, () => {
  console.log(catAscii);
});
