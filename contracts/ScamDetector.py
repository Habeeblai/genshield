# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json
import typing

class ScamDetector(gl.Contract):
    """
    Intelligent Contract for detecting scams, phishing, and manipulation.
    Analyzes text, links, and image descriptions using on-chain AI consensus.
    """
    last_scan_id: u256

    def __init__(self):
        self.last_scan_id = u256(0)

    def _get_shared_prompt(self, input_type, input_data):
        return f"""
        You are an advanced AI Scam Detector operating in a high-stakes blockchain environment.
        Your task is to analyze a {input_type} and classify it based on potential risk.

        INPUT {input_type.upper()}:
        "{input_data}"

        DETECTION CRITERIA:
        1. Phishing: Unofficial links, urgent requests for keys/passwords, impersonating brands.
        2. Financial Scams: "Get rich quick", guaranteed returns, fake giveaways, "send crypto to get double".
        3. Social Engineering: Manipulation, emotional blackmail, fake authority figures.
        4. Technical Red Flags: Obfuscated URLs, look-alike domains (e.g., binance.co vs binance.com).

        BEHAVIOR GUIDELINES:
        - Be highly skeptical.
        - If uncertain, default to "SUSPICIOUS".
        - Think step-by-step internally, but only provide the short reasoning in the final output.
        - Reasoning must be 2-3 sentences max.
        - Produce consistent, objective outputs to ensure consensus across validators.

        STRICT OUTPUT FORMAT:
        You must respond with ONLY a valid JSON object. No reasoning outside the JSON. No markdown backticks.
        Format:
        {{
          "classification": "SCAM" | "SUSPICIOUS" | "SAFE",
          "reasoning": "string explanation",
          "confidence": number (0-100)
        }}
        """

    def _analyze(self, input_type, input_data):
        prompt = self._get_shared_prompt(input_type, input_data)

        def leader_fn():
            response = gl.nondet.exec_prompt(prompt, response_format="json")
            return response

        def validator_fn(leader_res):
            if not isinstance(leader_res, gl.vm.Return):
                return False
            my_res = leader_fn()
            return my_res["classification"] == leader_res.calldata["classification"]

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        return str(json.dumps(result))

    @gl.public.write
    def check_text(self, message: str) -> typing.Any:
        return self._analyze("text message", message)

    @gl.public.write
    def check_link(self, link: str) -> typing.Any:
        return self._analyze("url/link", link)

    @gl.public.write
    def check_image(self, description: str) -> typing.Any:
        return self._analyze("screenshot description", description)
