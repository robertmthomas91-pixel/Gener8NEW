(async () => {
    try {
        const req = await fetch('http://0.0.0.0:3000/api/ai/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [{ text: 'A cinematic scene' }] },
                config: { imageConfig: { aspectRatio: '16:9', numberOfImages: 1 } }
            })
        });
        const text = await req.text();
        console.log(req.status, text.substring(0, 500));
    } catch(e) {
        console.log(e);
    }
})();
