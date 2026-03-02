import { describe, expect, test } from "bun:test";
import { tokenize } from "../tokenizer.js";

describe("tokenize", () => {
  test("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  test("lowercases words", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });

  test("strips Discord user mentions", () => {
    expect(tokenize("<@123456789> hello")).toEqual(["hello"]);
    expect(tokenize("<@!123456789> hi")).toEqual(["hi"]);
  });

  test("strips Discord channel mentions", () => {
    expect(tokenize("<#123456789> hello")).toEqual(["hello"]);
  });

  test("strips Discord role mentions", () => {
    expect(tokenize("<@&123456789> hello")).toEqual(["hello"]);
  });

  test("strips Discord custom emoji", () => {
    expect(tokenize("<:smile:123456789> nice")).toEqual(["nice"]);
    expect(tokenize("<a:wave:123456789> bye")).toEqual(["bye"]);
  });

  test("strips URLs", () => {
    expect(tokenize("check https://example.com out")).toEqual(["check", "out"]);
    expect(tokenize("http://foo.bar/baz?q=1 word")).toEqual(["word"]);
  });

  test("strips emoji shortcodes", () => {
    expect(tokenize(":smile: great")).toEqual(["great"]);
    expect(tokenize(":thumbs_up: yes")).toEqual(["yes"]);
  });

  test("strips unicode emoji", () => {
    expect(tokenize("hello 😀 world")).toEqual(["hello", "world"]);
  });

  test("strips markdown formatting characters", () => {
    expect(tokenize("**bold** _italic_ ~strike~")).toEqual(["bold", "italic", "strike"]);
    expect(tokenize("`code` |pipe| >quote")).toEqual(["code", "pipe", "quote"]);
  });

  test("discards tokens shorter than 2 characters", () => {
    expect(tokenize("a go to")).toEqual(["go", "to"]);
  });

  test("discards pure number tokens", () => {
    expect(tokenize("foo 123 bar")).toEqual(["foo", "bar"]);
  });

  test("keeps contractions (apostrophe in middle)", () => {
    expect(tokenize("don't won't")).toEqual(["don't", "won't"]);
  });

  test("strips surrounding apostrophes", () => {
    expect(tokenize("'hello' world")).toEqual(["hello", "world"]);
  });

  test("splits on punctuation", () => {
    expect(tokenize("hello, world!")).toEqual(["hello", "world"]);
  });

  test("handles multiple spaces and newlines", () => {
    expect(tokenize("  hello   world  ")).toEqual(["hello", "world"]);
  });

  test("returns multiple words from a normal sentence", () => {
    const result = tokenize("I love programming so much");
    expect(result).toContain("love");
    expect(result).toContain("programming");
    expect(result).toContain("much");
  });

  test("preserves Swedish characters å, ö, ä", () => {
    const result = tokenize("för bra på håll instängd nyår");
    expect(result).toContain("för");
    expect(result).toContain("bra");
    expect(result).toContain("på");
    expect(result).toContain("håll");
    expect(result).toContain("instängd");
    expect(result).toContain("nyår");
  });

  test("handles real Discord Swedish message", () => {
    const result = tokenize("haha jo, fast den är ju lite åt fel håll/instängd för det");
    expect(result).toContain("haha");
    expect(result).toContain("håll");
    expect(result).toContain("instängd");
    expect(result).toContain("för");
    // Slash is a word separator
    expect(result).not.toContain("håll/instängd");
  });

  test("strips Discord custom emoji leaving no tokens", () => {
    expect(tokenize("<:pout:624949025199751189>")).toEqual([]);
  });

  test("strips Discord role mention", () => {
    const result = tokenize("<@&1077301468719231016> Vill ni köra nyår");
    expect(result).not.toContain("<@&1077301468719231016>");
    expect(result).toContain("vill");
    expect(result).toContain("nyår");
  });
});
