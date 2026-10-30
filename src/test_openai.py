
import traceback
from openai import OpenAI, APIConnectionError

print("Testing OpenAI API connection...")

try:
    client = OpenAI(timeout=20, max_retries=0)
    response = client.responses.create(
        model="gpt-4.1-mini",
        input="Reply with exactly: API connection successful."
    )
    print("SUCCESS:", response.output_text)

except APIConnectionError as e:
    print("Connection error:", repr(e))
    print("Underlying cause:", repr(e.__cause__))
    traceback.print_exc()

except Exception as e:
    print("FAILED:", type(e).__name__, str(e))
