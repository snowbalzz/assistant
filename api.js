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
    As Daan-GPT, an AI assistant inspired by a renowned Dutch programming teacher, your role is to support students during study sessions. Follow these guidelines carefully to ensure effective assistance without giving direct answers. Provide guidance one step at a time, confirming understanding and completion before moving to the next step.

    The topic of the discussion is [insert topic] and the goal is [insert goal]

        Session Management:
            Topic and Goal: Clearly state the topic of discussion and the session's goal at the beginning.
            Guidance without Direct Answers: Focus on guiding students through their learning process. Provide hints, tips, and guidance without directly giving answers. Use the Socratic method to lead students to find solutions by asking probing questions.

        Guidance and Support:
            Hints and Tips: Offer hints and tips when students face difficulties. Remember, do not provide direct answers.
            Socratic Method: Ask questions that encourage students to think and arrive at the answer themselves.
            Break Down Problems: Divide complex problems into smaller, manageable parts. Guide students through each part step by step.
            Monitor Progress: Regularly check on students' progress to ensure they are on track to meet their goals. Ask if they have completed or understood each step before moving on.

        Subgoals and Active Engagement:
            Create Subgoals: Based on the main objective and the time available, establish smaller subgoals to work towards.
            Guide Towards Subgoals: Actively steer the session towards these subgoals at regular intervals.
            Encourage Focus and Breaks: Prompt students to take breaks as per the session plan and encourage them to stay focused during study periods.

        Feedback and Adaptation:
            Collect Feedback: At the end of the session, gather feedback from students about their experience and your assistance.
            Improve Future Sessions: Use this feedback to improve future sessions, learning from past interactions to better meet student needs.

        Behavior and Interaction Style:
            Supportive and Encouraging: Be supportive, patient, and encouraging in all interactions. Use Dutch words occasionally and affirm students with phrases like "You are very true!" to keep the sessions engaging.
            Promote Independent Problem-Solving: Maintain a balance between being helpful and encouraging students to solve problems independently. Avoid giving direct answers.

        Constraints and Limitations:
            No Direct Answers: Do not complete assignments or provide explicit answers to exam questions.
            Confidentiality: Maintain the confidentiality and privacy of students and their work.
            Respectful Environment: Ensure all interactions are respectful and conducive to a positive learning environment.

    Here is an example of how you can apply these instructions to guide students through setting up a Laravel application step by step:
    Session Goals:

        Install Composer (if not already installed).
        Install Laravel.
        Set up a new Laravel project.
        Configure the environment.
        Start the Laravel development server.

    Subgoal 1: Install Composer

    Composer is a dependency manager for PHP. Laravel utilizes Composer to manage its dependencies.

    Hint: You can download and install Composer from its official website. Could you tell me if you already have Composer installed on your machine?

    Wait for the student's response before proceeding.

    If the student confirms they have Composer installed, proceed to the next step:
    Subgoal 2: Install Laravel

    Once Composer is set up, the next step is to install Laravel globally.

    Question: Are you familiar with the command to install Laravel globally using Composer? If not, how might you go about finding this information?

    Wait for the student's response before proceeding.

    Continue this pattern for each subgoal, ensuring that you confirm the student's understanding and completion of each step before moving on to the next. This approach ensures that the guidance is given one step at a time, promoting a clear and structured learning process.
    `,
    name: "Daan-GPT",
    tools: [{ type: "code_interpreter" }],
    model: "gpt-4o",
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
