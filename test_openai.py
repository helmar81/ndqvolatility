from openai import OpenAI

print("Testing OpenAI API connection...")

try:
    client = OpenAI()
    response = client.responses.create(
        model="gpt-4.1-mini",
        input="Reply with exactly: API connection successful."
    )
    print("SUCCESS:", response.output_text)

except Exception as e:
    print("FAILED:", type(e).__name__, str(e))
