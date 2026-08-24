import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CATEGORIES = ['photography', 'gaming', 'camping', 'diy', 'music', 'sports', 'other'];

// Backlog S: AI auto-fill a single item's form fields from its own photo —
// distinct from Q (one photo of a pile of objects -> multiple detected
// items), which is a separate, not-yet-built feature. This is the
// one-item-at-a-time case: AddItemScreen sends the item's own cover photo,
// this suggests title/category/description/daily_price, the user reviews
// and edits before saving through the existing Save path unchanged (SAS —
// this never writes to `items` itself).
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });
    }

    const { image_base64, mime_type } = await req.json();
    if (!image_base64) {
      return new Response(JSON.stringify({ error: 'image_base64 is required' }), { status: 400, headers: corsHeaders });
    }

    const groqKey = Deno.env.get('GROQ_KEY');
    if (!groqKey) {
      return new Response(JSON.stringify({ error: 'AI auto-fill is not configured' }), { status: 503, headers: corsHeaders });
    }

    const dataUri = `data:${mime_type || 'image/jpeg'};base64,${image_base64}`;

    const prompt = `You are helping someone list an item for rent on a peer-to-peer rental marketplace in Israel. Look at this photo and identify the item being listed.

Return ONLY a JSON object with exactly these fields:
{
  "title": "short product name, e.g. 'Canon EOS R5 Camera'",
  "category": "one of: ${CATEGORIES.join(', ')}",
  "description": "2-3 sentences describing the item and its apparent condition, written for a rental listing",
  "daily_price": integer, a reasonable suggested daily rental price in Israeli shekels (no currency symbol)
}

If you cannot clearly identify a rentable item, use "other" for category and describe what you actually see. Return ONLY the JSON object — no markdown, no code fences, no extra text.`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        temperature: 0.2,
        max_tokens: 512,
        response_format: { type: 'json_object' },
        // Qwen's thinking mode is on by default and emits reasoning content
        // before the actual answer, which fails Groq's json_object schema
        // validation (the "failed_generation - failed to validate json"
        // error) since the completion isn't pure JSON anymore.
        reasoning_format: 'hidden',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUri } },
            ],
          },
        ],
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      return new Response(JSON.stringify({ error: `AI analysis failed: ${errText}` }), { status: 502, headers: corsHeaders });
    }

    const groqData = await groqRes.json();
    const rawText: string = groqData?.choices?.[0]?.message?.content ?? '';
    const cleaned = rawText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'other';
    const dailyPrice = Number(parsed.daily_price);

    return new Response(
      JSON.stringify({
        title: typeof parsed.title === 'string' ? parsed.title.slice(0, 100) : '',
        category,
        description: typeof parsed.description === 'string' ? parsed.description.slice(0, 1000) : '',
        daily_price: Number.isFinite(dailyPrice) && dailyPrice > 0 ? Math.round(dailyPrice) : null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? 'Could not analyze the photo' }), { status: 500, headers: corsHeaders });
  }
});
