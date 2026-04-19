require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";

const careerData = JSON.parse(fs.readFileSync("./careers.json", "utf-8"));

// ─── Helper: call Groq ────────────────────────────────────────────────────────
async function callGroq(systemPrompt, userPrompt, maxTokens = 1024) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error: ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// ─── Basic routes ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.send("Career Guide Backend is Running ✅"));

app.get("/api/careers", (req, res) => res.json(careerData));

app.get("/api/careers/:title", (req, res) => {
  const title = decodeURIComponent(req.params.title);
  const career = careerData.find(
    c => c.title.toLowerCase() === title.toLowerCase()
  );
  if (!career) return res.status(404).json({ message: "Career not found" });
  res.json(career);
});

// ─── ROUTE 1: AI Dynamic Follow-up Question ──────────────────────────────────
// Frontend sends answers so far → AI returns next smart question
app.post("/api/next-question", async (req, res) => {
  const { answeredQuestions } = req.body;
  // answeredQuestions = [{ question: "...", answer: "..." }, ...]

  const system = `You are a smart career counselor for Indian students (Class 10-12 and graduates).
Your job is to ask ONE insightful follow-up question based on the student's previous answers.
The question should dig deeper into their interests, strengths, or personality to refine career recommendations.
Always respond with ONLY a valid JSON object, no extra text, no markdown.
Format: { "question": "...", "options": ["option1", "option2", "option3", "option4", "option5", "option6"] }
Options should be 4-6 in number. Make options specific and relatable for Indian students.`;

  const user = answeredQuestions.length === 0
    ? `Generate the FIRST career assessment question to understand the student's broad interests.`
    : `The student has answered these questions so far:
${answeredQuestions.map((q, i) => `Q${i+1}: ${q.question}\nAnswer: ${q.answer}`).join("\n\n")}

Generate the NEXT follow-up question that will help narrow down their ideal career. 
Do NOT repeat similar questions. Go deeper based on their answers.`;

  try {
    const raw = await callGroq(system, user, 512);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    res.json(parsed);
  } catch (err) {
    console.error("next-question error:", err.message);
    res.status(500).json({ error: "Failed to generate question" });
  }
});

// ─── ROUTE 2: AI Result Analysis ─────────────────────────────────────────────
// Replaces old score-counting logic with real AI analysis
app.post("/api/result", async (req, res) => {
  const { answeredQuestions } = req.body;
  // answeredQuestions = [{ question: "...", answer: "..." }, ...]

  const availableCareers = careerData.map(c => ({
    title: c.title,
    category: c.category,
    description: c.description
  }));

  const system = `You are an expert Indian career counselor with deep knowledge of career paths for students.
Analyze the student's assessment answers and recommend careers from the provided list.
Always respond with ONLY a valid JSON object, no markdown, no extra text.
Format exactly:
{
  "topCategory": "one of: creative|technology|healthcare|business|defence|media|education|law",
  "categoryReason": "2-3 sentence explanation of why this category suits them",
  "topRecommendations": [
    { "title": "exact title from list", "description": "...", "whyMatch": "1 sentence personal reason" }
  ],
  "otherMatches": [
    { "title": "exact title from list", "description": "...", "whyMatch": "1 sentence personal reason" }
  ],
  "personalInsight": "2-3 sentence personalized message to the student about their strengths"
}
topRecommendations: 3 best matches. otherMatches: 2-3 additional matches from different categories.
Only use career titles that EXACTLY match the provided list.`;

  const user = `Student's Assessment Answers:
${answeredQuestions.map((q, i) => `Q${i+1}: ${q.question}\nAnswer: ${q.answer}`).join("\n\n")}

Available Careers List:
${JSON.stringify(availableCareers, null, 2)}

Analyze their answers and recommend the most suitable careers from the list above.`;

  try {
    const raw = await callGroq(system, user, 1500);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Enrich with full career data from JSON
    const enrich = (rec) => {
      const full = careerData.find(
        c => c.title.toLowerCase() === rec.title.toLowerCase()
      );
      return { ...(full || {}), ...rec };
    };

    parsed.topRecommendations = (parsed.topRecommendations || []).map(enrich);
    parsed.otherMatches = (parsed.otherMatches || []).map(enrich);

    res.json(parsed);
  } catch (err) {
    console.error("result error:", err.message);
    res.status(500).json({ error: "Failed to analyze results" });
  }
});

// ─── ROUTE 3: AI Career Detail / Roadmap ─────────────────────────────────────
app.post("/api/career-roadmap", async (req, res) => {
  const { careerTitle, userAnswers } = req.body;

  const baseCareer = careerData.find(
    c => c.title.toLowerCase() === careerTitle.toLowerCase()
  );

  const system = `You are an expert Indian career counselor helping students who have just passed or are about to pass Class 12.
These students are confused about what to do after 12th and need a clear, step-by-step roadmap.
Always respond with ONLY a valid JSON object, no markdown, no extra text.

Format:
{
  "overview": "3-4 sentence overview of this career in India — what it is, scope, and why it is good after 12th",
  "salaryRange": "entry level to senior level salary in India (e.g., ₹3-5 LPA to ₹25-30 LPA)",
  "jobMarket": "1 line: current demand and job outlook in India",
  "roadmap": [
    {
      "step": 1,
      "title": "Step title (e.g., Crack the Entrance Exam)",
      "duration": "e.g., 6 months - 1 year",
      "description": "Detailed what to do — which exam to crack, what to study, which coaching to join, how to prepare"
    }
  ],
  "topColleges": [
    {
      "name": "College name",
      "location": "City, State",
      "course": "Specific course offered (e.g., B.Tech CSE, MBBS, B.Des)",
      "fees": "Approximate annual fees (e.g., ₹1-2 LPA or ₹50,000/year)",
      "why": "1 sentence why this college is good for this career"
    }
  ],
  "topSkills": ["skill1", "skill2", "skill3", "skill4", "skill5"],
  "prosAndCons": {
    "pros": ["pro1", "pro2", "pro3"],
    "cons": ["con1", "con2", "con3"]
  },
  "indianContext": "Specific India-focused advice — which cities have most opportunities, government vs private, future scope"
}

Roadmap MUST follow this student journey starting from after 12th:
- Step 1: Which entrance exam to crack (e.g., JEE, NEET, CLAT, NIFT, NDA, CUET, etc.) + what subjects to focus on
- Step 2: Coaching / self-study guidance — which coaching institute, online platform, how many months to prepare
- Step 3: College admission — which colleges to target, documents needed, counselling process
- Step 4: Degree / course duration — what you study, important subjects, internships during degree
- Step 5: Entry level job / first opportunity — how to get first job, portfolio, placements, exams like UPSC/CA/Bar
- (Optional Step 6): Growth / specialization path

Keep roadmap to 5-6 steps max. Be very specific and practical for Indian students.
For topColleges, recommend 4-5 real well-known Indian colleges with accurate info.`;

  const user = `Career: ${careerTitle}
${baseCareer ? `Base career info from our database: ${JSON.stringify(baseCareer)}` : ""}
${userAnswers && userAnswers.length ? `Student's assessment answers: ${JSON.stringify(userAnswers)}` : ""}

Generate the complete roadmap for a Class 12 pass Indian student who wants to pursue ${careerTitle}.`;

  try {
    const raw = await callGroq(system, user, 2000);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Merge base data but AI colleges & roadmap take priority
    res.json({ ...baseCareer, ...parsed });
  } catch (err) {
    console.error("roadmap error:", err.message);
    res.status(500).json({ error: "Failed to generate roadmap" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
