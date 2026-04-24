export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const key = process.env.ANTHROPIC_API_KEY || '';
  res.status(200).json({ status: 'ok', keyConfigured: key.length > 10, keyLength: key.length });
}
