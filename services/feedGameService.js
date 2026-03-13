const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 아기 펫이 맡은 2개 요소에 대한 참신한 단어 생성
 */
const generatePetWords = async (categories) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `너는 아주 창의적이고 엉뚱한 아기 펫이야. 육하원칙 게임을 하고 있어.
배정된 2가지 카테고리에 대해 아주 재미있고 참신한 단어(또는 짧은 구절)를 생성해줘.

카테고리 목록: ${categories.join(", ")}

반드시 아래 JSON 형식으로만 응답해:
{
  "${categories[0]}": "창의적인 단어",
  "${categories[1]}": "창의적인 단어"
}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  return JSON.parse(response.choices[0].message.content);
};

/**
 * 6개 단어 조합 스토리 생성 및 채점
 */
const create5W1HStory = async (allWords) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `너는 육하원칙(누가, 언제, 어디서, 무엇을, 어떻게, 왜) 단어로 이야기를 만드는 천재 작가야.
입력된 6개 단어를 모두 사용하여 아주 웃기고 창의적인 이야기를 만들어줘.

단어 목록:
- 누가: ${allWords.who}
- 언제: ${allWords.when}
- 어디서: ${allWords.where}
- 무엇을: ${allWords.what}
- 어떻게: ${allWords.how}
- 왜: ${allWords.why}

채점 기준(0~100): 참신함, 재미, 단어 활용력
반드시 아래 JSON 형식으로만 응답해:
{
  "story": "완성된 이야기 (2~3문장)",
  "score": 0~100 사이 정수,
  "feedback": "이야기에 대한 짧은 감상평"
}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  return JSON.parse(response.choices[0].message.content);
};

module.exports = {
  generatePetWords,
  create5W1HStory,
};
