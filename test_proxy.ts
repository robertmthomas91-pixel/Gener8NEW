import fs from "fs";

async function test() {
  const res = await fetch("http://localhost:3000/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini-2.5-flash",
      contents: "Say hello world"
    })
  });
  const data = await res.json();
  console.log("Success! Data:", JSON.stringify(data, null, 2));
}
test();
