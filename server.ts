import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isGemini35FlashQuotaExceeded = false;

function getModelsWithFallback(baseModels: string[]): string[] {
  if (isGemini35FlashQuotaExceeded) {
    // If gemini-3.5-flash is marked as out of quota, move it to the end of the list
    return baseModels.filter((m) => m !== "gemini-3.5-flash").concat(["gemini-3.5-flash"]);
  }
  return baseModels;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  // API Routes
  app.post("/api/classify-commitment", async (req, res) => {
    try {
      const { commitment, deadline } = req.body;

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const systemInstruction = `You are an expert task classifier, title refiner, deadline validator, and commitment content validator.
Given the user's commitment and deadline text, you must perform four tasks:
1. Classify the commitment into EXACTLY one of the following four archetypes:
- "Inbound Inquiry" (e.g., reply to an email, message, question, request for info)
- "Job Application" (e.g., apply to a role, role application, internships, submitting cover letter/resume)
- "Long-form Writing" (e.g., report, essay, thesis, structured outline, blog post, document, paper)
- "Actionable Task" (e.g., standard deadlines, code assignments, feature implementations, to-dos)

2. Generate a clean, compact, properly-capitalized "title" (ideally 3-7 words) that conveys the commitment instantly.
Examples:
- "write an mail to sai girish on follow up of discussed matter" -> "Follow-up Email to Sai Girish"
- "apply to the singlestore cloud foundations role by friday" -> "SingleStore Cloud Foundations Application"

CRITICAL RULES FOR THE TITLE:
- ASCII characters only. No em-dashes, en-dashes, curly quotes, or ellipses. Use straight hyphens, commas, periods.
- NEVER use any of these banned words/phrases: passionate, synergy, leverage, utilize, honed, wide array, fast-paced, eager, "keen to", "excited to", thrilled, "bridging the gap", "global implications".

3. Validate the deadline. The deadline is free-text natural language (e.g., "tomorrow", "Friday 5pm").
CRITICAL: If the deadline text is completely meaningless, gibberish (e.g., "s", "asdfasdf", "xyz"), has no temporal meaning whatsoever, or is impossible to resolve to any real date or relative time, you MUST set the "deadlineInvalid" key to true in your JSON output. Otherwise, set "deadlineInvalid" to false.

4. Validate the commitment text content.
CRITICAL: If the commitment text is semantically CONTENTLESS, vague, or meaningless (such as "something", "stuff", "a thing", "task", "anything", "nothing", "junk", "asdf", "hello", "hi", "etc"), or if it has NO identifiable task, action, or subject (e.g., no clear actionable subject of what needs to be done), you MUST set the "commitmentInvalid" key to true in your JSON output. Otherwise, set "commitmentInvalid" to false.

Return a JSON object containing exactly these four keys: "archetype", "title", "deadlineInvalid", and "commitmentInvalid". No other keys, no formatting.
Example output format: {"archetype": "Job Application", "title": "SingleStore Cloud Foundations Application", "deadlineInvalid": false, "commitmentInvalid": false}`;

      const prompt = `Commitment: ${commitment}
Deadline: ${deadline}`;

      let response;
      let lastError;
      const MAX_RETRIES = 3;
      const CLASSIFY_MODELS = getModelsWithFallback([
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-flash-latest",
      ]);

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const modelToTry =
          CLASSIFY_MODELS[attempt - 1] ||
          CLASSIFY_MODELS[CLASSIFY_MODELS.length - 1];
        try {
          response = await ai.models.generateContent({
            model: modelToTry,
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
            },
          });
          break; // Success
        } catch (error: any) {
          lastError = error;
          const errMsg = error?.message || (typeof error === "string" ? error : "");
          const isQuota =
            errMsg.includes("Quota exceeded") ||
            error?.status === "RESOURCE_EXHAUSTED" ||
            error?.status === 429;
          if (modelToTry === "gemini-3.5-flash" && isQuota) {
            isGemini35FlashQuotaExceeded = true;
          }
          if (attempt < MAX_RETRIES) {
            console.log(
              `Model ${modelToTry} failed: ${error?.message || error}. Retrying with fallback... (Attempt ${attempt}/${MAX_RETRIES})`
            );
            await new Promise((r) => setTimeout(r, 1000));
          } else {
            throw error;
          }
        }
      }

      if (!response) {
        throw lastError;
      }

      let parsedData;
      try {
        parsedData = JSON.parse(response.text || "{}");
      } catch (e) {
        parsedData = {
          archetype: "Actionable Task",
          title: commitment,
          deadlineInvalid: false,
          commitmentInvalid: false,
        };
      }

      res.json(parsedData);
    } catch (error: any) {
      console.error("Error classifying commitment:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to classify commitment." });
    }
  });

  app.post("/api/generate-cover-letter", async (req, res) => {
    try {
      const {
        commitment,
        deadline,
        context,
        profile,
        systemInstruction,
        resumes,
        resumeText,
        currentLocalTime,
        completedCommitments,
      } = req.body;

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const parts: any[] = [];

      if (resumes && resumes.length > 0) {
        for (const r of resumes) {
          parts.push({
            inlineData: {
              data: r.data,
              mimeType: r.mimeType,
            },
          });
        }
      }

      let textPrompt = `Commitment: ${commitment}
Deadline: ${deadline}
Reference Current Local Time: ${currentLocalTime || new Date().toString()}
Context: ${context || "None provided"}
`;

      if (profile && (profile.name || profile.institute || profile.gradYear)) {
        textPrompt += `\nUser Identity Profile (Known Facts to use instead of placeholders):
- Name: ${profile.name || ""}
- Institute: ${profile.institute || ""}
- Grad Year: ${profile.gradYear || ""}

CRITICAL IDENTITY REQUIREMENT: If Name, Institute, and Grad Year are specified in this profile, you MUST use them verbatim in the sign-off, signature block, or greetings in the artifact. Never invent placeholder names or default names. For example, sign off exactly with the provided details:
${profile.name || "[INSERT NAME HERE]"}
${profile.institute || "[INSERT INSTITUTE HERE]"}, ${profile.gradYear || "[INSERT GRAD YEAR HERE]"}
`;
      }

      if (resumeText) {
        textPrompt += `\nCandidate Resumes/Background Text:\n${resumeText}\n`;
      }

      const rulesBlock = `NON-NEGOTIABLE RULES (follow all):
- ASCII only. No em-dashes, en-dashes, curly quotes, or ellipses. Straight hyphens, commas, periods.
- BANNED words/phrases (never use): passionate, synergy, leverage, utilize, utilizing, honed, wide array, fast-paced, eager, keen to, excited to, thrilled, "bridging the gap", "global implications", "I thrive", "I am drawn to", "look forward to the possibility", "Thank you for considering my application". Convey interest through specifics, not adjectives.
- Cover letters and emails: first person throughout; never name the user in the body; signature is one block using the profile (Name, Institute, Year).
- Cover letter salutation MUST name the company: "Dear [Company] Hiring Team,". Never "Dear Hiring Manager,".
- Use only facts from the user's provided context/resume/profile. If a required detail is genuinely missing, use [INSERT X HERE] in capitals. Never invent facts; never use any other placeholder style.`;

      textPrompt += `\n${rulesBlock}\n\nPlease write the first domino following the system instructions.`;

      parts.push({ text: textPrompt });

      let adjustmentBufferMinutes = 0;
      let adjustmentExplanation = "";

      if (completedCommitments && Array.isArray(completedCommitments) && completedCommitments.length >= 2) {
        let lateCount = 0;
        let onTimeCount = 0;
        completedCommitments.forEach((c: any) => {
          if (c.timing === "late") {
            lateCount++;
          } else if (c.timing === "on-time") {
            onTimeCount++;
          }
        });
        const total = completedCommitments.length;
        if (lateCount > 0 || onTimeCount > 0.5 * total) {
          adjustmentBufferMinutes = 30;
          if (lateCount > 0 && onTimeCount > 0) {
            adjustmentExplanation = `Added a 30-min buffer based on your tendency to start near or past the deadline in ${lateCount + onTimeCount} of your ${total} completed tasks.`;
          } else if (lateCount > 0) {
            adjustmentExplanation = `Added a 30-min buffer based on your tendency to complete tasks past the deadline in ${lateCount} of your ${total} completed tasks.`;
          } else {
            adjustmentExplanation = `Added a 30-min buffer based on your tendency to complete tasks after the start-by time in ${onTimeCount} of your ${total} completed tasks.`;
          }
        }
      }

      let finalSystemInstruction = systemInstruction || "";
      if (finalSystemInstruction) {
        finalSystemInstruction = finalSystemInstruction.replace(
          'Your goal is to output JSON with EXACTLY three fields: "archetype", "reasoning_trace", and "artifact".',
          'Your goal is to output JSON with EXACTLY six fields: "archetype", "reasoning_trace", "artifact", "deadlineISO", "startByISO", and "effortHours".'
        );
        finalSystemInstruction += `\n\nAdditionally, you must compute and include these three machine-readable fields in the JSON object:
- "deadlineISO": The deadline converted to an absolute machine-readable ISO 8601 datetime (e.g., "2026-06-25T23:59:00-07:00"). Use the "Reference Current Local Time" provided in the prompt to resolve relative text like "tomorrow" or "Friday 5pm". If the deadline has no time specified, assume 23:59 local.
- "startByISO": The backward-planned start-by moment (deadline minus estimated effort and buffer) as an absolute machine-readable ISO 8601 datetime.
- "effortHours": The estimated effort as a number (e.g. 1.5 or 2.0).
Ensure both datetimes are valid ISO 8601 strings, e.g., "2026-06-25T17:00:00-07:00".

CRITICAL DEADLINE VALIDATION: If the deadline text is completely meaningless, gibberish (e.g., "s", "asdfasdf", "xyz"), has no temporal meaning whatsoever, or is impossible to resolve to any real date or relative time, you MUST set the "deadlineISO" field to the literal string "INVALID" and set the "startByISO" field to the literal string "INVALID".`;

        if (adjustmentBufferMinutes > 0 && adjustmentExplanation) {
          finalSystemInstruction += `\n\nCRITICAL ADAPTATION REQUIRED:
- The user's completed history shows they tend to start late or run late.
- To protect their focus window, you MUST add exactly a 30-minute buffer to your estimated effort (i.e. startByISO should be exactly 30 minutes earlier than normal backward planning).
- You MUST append exactly this sentence at the very end of your "reasoning_trace" field (after your standard trace, preceded by a space): "${adjustmentExplanation}"`;
        }
      }

      let response;
      let lastError;
      const MAX_RETRIES = 3;
      const GENERATE_MODELS = getModelsWithFallback([
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-flash-latest",
      ]);

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const modelToTry =
          GENERATE_MODELS[attempt - 1] ||
          GENERATE_MODELS[GENERATE_MODELS.length - 1];
        try {
          response = await ai.models.generateContent({
            model: modelToTry,
            contents: parts,
            config: {
              systemInstruction: finalSystemInstruction,
              responseMimeType: "application/json",
            },
          });
          break; // Success
        } catch (error: any) {
          lastError = error;
          const errMsg = error?.message || (typeof error === "string" ? error : "");
          const isQuota =
            errMsg.includes("Quota exceeded") ||
            error?.status === "RESOURCE_EXHAUSTED" ||
            error?.status === 429;
          if (modelToTry === "gemini-3.5-flash" && isQuota) {
            isGemini35FlashQuotaExceeded = true;
          }
          if (attempt < MAX_RETRIES) {
            console.log(
              `Model ${modelToTry} failed: ${error?.message || error}. Retrying with fallback... (Attempt ${attempt}/${MAX_RETRIES})`
            );
            await new Promise((r) => setTimeout(r, 1000));
          } else {
            throw error; // If out of retries or it's a different error
          }
        }
      }

      if (!response) {
        throw lastError;
      }

       let parsedData;
      try {
        parsedData = JSON.parse(response.text || "{}");
        if (adjustmentBufferMinutes > 0 && adjustmentExplanation && parsedData) {
          if (parsedData.reasoning_trace && typeof parsedData.reasoning_trace === "string") {
            if (!parsedData.reasoning_trace.includes("buffer")) {
              parsedData.reasoning_trace = parsedData.reasoning_trace.trim() + " " + adjustmentExplanation;
            }
          } else {
            parsedData.reasoning_trace = adjustmentExplanation;
          }
        }
      } catch (e) {
        parsedData = {
          reasoning_trace: "Failed to parse JSON reasoning trace." + (adjustmentExplanation ? ` ${adjustmentExplanation}` : ""),
          artifact: response.text,
        };
      }

      res.json(parsedData);
    } catch (error: any) {
      console.error("Error generating cover letter:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to generate cover letter." });
    }
  });

  app.post("/api/scan-radar", async (req, res) => {
    try {
      const { emails } = req.body;

      if (!emails || !Array.isArray(emails)) {
        return res.status(400).json({ error: "Emails array is required." });
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const systemInstruction = `You are an expert commitment radar and task-extraction assistant called Runway Radar.
Analyze the provided recent emails from the user's inbox and identify genuine, actionable commitments that imply an action the user needs to take (e.g., replying to a client, preparing a document, applying for a job, submitting an assignment, doing a task, meeting a deadline).

For each genuine commitment found, extract:
- "title": A short, clear commitment title describing what the user must do (e.g. "Submit Q2 report" or "Reply to John's partnership request").
- "sender": The sender of the email (display name and/or email address).
- "deadline": An inferred deadline from the email text if one exists (e.g., "by Friday 5pm", "tomorrow", or a specific date/time). If there is no clear deadline, output "no clear deadline" - do NOT invent one.
- "reason": A single, brief, clear, one-line explanation of why this email was flagged as a commitment.
- "emailId": The original ID of the email.
- "context": A brief snippet of context from the email body (1-2 sentences) to help understand the task.

CRITICAL RULES:
- Return a JSON object with a single key "commitments" containing an array of extracted commitments.
- IGNORE all newsletters, promotions, automated notifications, spam, receipts, social updates, and any emails with no clear actionable task for the user.
- If no emails contain any actionable commitments, return an empty array: {"commitments": []}. Do NOT invent commitments.
- Output ASCII only. No em-dashes, en-dashes, curly quotes, or ellipses. Straight hyphens, commas, periods.`;

      const prompt = `Here are the recent emails from the user's inbox:
${JSON.stringify(emails, null, 2)}`;

      let response;
      let lastError;
      const MAX_RETRIES = 3;
      const SCAN_MODELS = getModelsWithFallback([
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-flash-latest",
      ]);

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const modelToTry =
          SCAN_MODELS[attempt - 1] ||
          SCAN_MODELS[SCAN_MODELS.length - 1];
        try {
          response = await ai.models.generateContent({
            model: modelToTry,
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
            },
          });
          break; // Success
        } catch (error: any) {
          lastError = error;
          const errMsg = error?.message || (typeof error === "string" ? error : "");
          const isQuota =
            errMsg.includes("Quota exceeded") ||
            error?.status === "RESOURCE_EXHAUSTED" ||
            error?.status === 429;
          if (modelToTry === "gemini-3.5-flash" && isQuota) {
            isGemini35FlashQuotaExceeded = true;
          }
          if (attempt < MAX_RETRIES) {
            console.log(
              `Model ${modelToTry} failed: ${error?.message || error}. Retrying with fallback... (Attempt ${attempt}/${MAX_RETRIES})`
            );
            await new Promise((r) => setTimeout(r, 1000));
          } else {
            throw error;
          }
        }
      }

      if (!response) {
        throw lastError;
      }

      let parsedData;
      try {
        parsedData = JSON.parse(response.text || "{}");
      } catch (e) {
        parsedData = {
          commitments: [],
        };
      }

      res.json(parsedData);
    } catch (error: any) {
      console.error("Error scanning radar:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to scan inbox using radar." });
    }
  });

  app.post("/api/preflight-briefing", async (req, res) => {
    try {
      const { commitments, completedCommitments, currentLocalTime } = req.body;

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const systemInstruction = `You are an expert aviation controller and air-traffic dispatcher for the Runway task system.
Your job is to provide a "PRE-FLIGHT BRIEFING" - a short, authoritative, cross-task triage summary.

The user has a dashboard showing active commitments ("planes on the runway") and completed/recently landed ones.

CRITICAL FORMATTING RULES:
1. Output MUST be short (2-4 sentences max).
2. It must be specific, analytical, and synthesize across the provided commitments.
3. Identify the single most urgent commitment and explain why (reference its start-by time or deadline).
4. Make a clear prioritization judgment (what to handle first, what can wait).
5. If completed commitments (flight logs) are provided and there are enough of them (2+), the briefing may include exactly ONE grounded observation about the user's pattern (e.g., "Across your 3 completed tasks, you have tended to start close to the start-by time" or "Your completed flight logs show an early takeoff tendency"). Only state patterns the completed data actually supports. If there is little or no completed history (fewer than 2 completed tasks), say absolutely nothing about completed patterns or statistics. Keep it objective, professional, and factual.
6. Do NOT output generic motivational text, standard filler, or fluff.
7. If there are no active commitments provided or the list is empty, respond with a short "Runway clear" message (e.g. "Runway is completely clear. All planes are safely landed. No active commitments require immediate triage.").
8. If there is only one active commitment, brief on just that single item.
9. Strictly output ASCII characters only. No em-dashes, en-dashes, curly quotes, or ellipses. Use straight hyphens, commas, periods, and standard quotes.
10. NEVER use any of these banned words/phrases: passionate, synergy, leverage, utilize, utilizing, honed, wide array, fast-paced, eager, keen to, excited to, thrilled, bridging the gap, global implications. Convey interest or urgency through specific facts, numbers, or deadlines.
11. Return a JSON object with a single key "briefing" containing the text string of the briefing. No markdown code blocks, just raw JSON.`;

      const prompt = `Current Date/Time: ${currentLocalTime || new Date().toString()}
Active Commitments: ${JSON.stringify(commitments || [])}
Completed Commitments (Flight logs): ${JSON.stringify(completedCommitments || [])}`;

      let response;
      let lastError;
      const MAX_RETRIES = 3;
      const BRIEF_MODELS = getModelsWithFallback([
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-flash-latest",
      ]);

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const modelToTry = BRIEF_MODELS[attempt - 1] || BRIEF_MODELS[BRIEF_MODELS.length - 1];
        try {
          response = await ai.models.generateContent({
            model: modelToTry,
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
            },
          });
          break; // Success
        } catch (error: any) {
          lastError = error;
          const errMsg = error?.message || (typeof error === "string" ? error : "");
          const isQuota =
            errMsg.includes("Quota exceeded") ||
            error?.status === "RESOURCE_EXHAUSTED" ||
            error?.status === 429;
          if (modelToTry === "gemini-3.5-flash" && isQuota) {
            isGemini35FlashQuotaExceeded = true;
          }
          if (attempt < MAX_RETRIES) {
            console.log(
              `Model ${modelToTry} failed: ${error?.message || error}. Retrying with fallback... (Attempt ${attempt}/${MAX_RETRIES})`
            );
            await new Promise((r) => setTimeout(r, 1000));
          } else {
            throw error;
          }
        }
      }

      if (!response) {
        throw lastError;
      }

      let parsedData;
      try {
        parsedData = JSON.parse(response.text || "{}");
      } catch (e) {
        parsedData = {
          briefing: response.text || "Unable to parse briefing."
        };
      }

      res.json(parsedData);
    } catch (error: any) {
      console.error("Error generating pre-flight briefing:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to generate pre-flight briefing." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
