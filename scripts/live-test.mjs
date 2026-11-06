const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3100';
const code = process.argv[2] ?? 'TCVN 9143:2022';
const normalizedCode = code.trim().replace(/\s+/g, ' ').replace(/\s*:\s*/, ':').toUpperCase();

const response = await fetch(
  `${baseUrl}/api/v1/standards/${encodeURIComponent(code)}`
);
const body = await response.json();

if (!response.ok) {
  console.error(`API returned HTTP ${response.status}:`, body);
  process.exitCode = 1;
} else if (body?.data?.code?.toUpperCase() !== normalizedCode || body?.data?.source !== 'VSQI') {
  console.error('Unexpected detail response:', body);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(body, null, 2));
}
