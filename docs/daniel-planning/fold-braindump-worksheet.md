# Fold: braindump worksheet

The purpose of this document is to get everything currently in your head onto a page so the gaps and contradictions become visible. It is not a deliverable. It is a raw material dump that becomes the input to the competitive scan, the interview guide, the positioning work, and the brand mark exploration.

## how to use this

**Write badly and fast.** Fragments are fine. The value is in coverage, not polish. If you find yourself composing sentences, you are going too slow.

**Do not research while answering.** If you don't know, write "don't know" and move on. The don't-knows are as informative as the answers.

**Mark confidence.** Put a tag at the end of any answer where it matters:
- `[K]` I know this, it is verified
- `[B]` I believe this, it is an assumption I would defend
- `[G]` I am guessing

**Timebox by part.** Part 1 is the longest and the most mechanical. Parts 2 and 3 are the highest value per minute. Part 4 is best done in a different sitting, ideally with a pencil in hand.

**Answer out of order.** Skip anything that stalls you. Come back or don't.

---

# Part 1: what is actually built

The goal here is to give me enough specificity to assess where Fold is genuinely differentiated versus where it overlaps with existing tools. Your CC Kaleida correction is exactly the pattern: I can name a comparator, but only you know whether it solves the same problem. Assume I know nothing about the current build beyond the early brief.

## 1.1 The forms

1. List every symmetry form currently shipping, with the name you use for it in the UI.
2. For each form, what parameters can the user change? Give the actual control names, not the concepts.
3. Which forms do people gravitate toward, and which ones sit unused?
4. Which form was hardest to get right, and what was hard about it?
5. Are there forms you have built but not shipped, or built and removed? Why?
6. What forms are on the list to build next, and what is the ordering logic?

## 1.2 Seamlessness and output quality

This is the area I most suspect is your real moat and the area I understand least.

7. What exactly happens at a mirror boundary in your implementation? Describe it as if to another developer.
8. What does "seamless" mean concretely in your build? What artifact are you eliminating that other tools produce?
9. What does the feathering control actually do, and what problem did it exist to solve?
10. How does the output hold up under extreme zoom into the source? Where does it fall apart?
11. Anti-aliasing and sampling: what is the strategy, and what is the failure mode?
12. Where do seams still appear? Under what conditions?
13. Take three named tools you have personally used (k24, FCP's kaleidoscope, Adobe Capture, whatever else). For each, what specifically does Fold do that it does not?

## 1.3 The source-region interaction

The "photoshoot within an image" idea lives or dies here.

14. Describe the interaction model for moving, rotating, and scaling the source region. On desktop. On touch. Are they the same mental model?
15. What visual feedback shows the user where the source region is and what it will produce?
16. How long does it take a user to go from one output to a meaningfully different output? Seconds? Clicks?
17. Is there any way to browse, sample, or randomize source regions, or is it purely manual?
18. Can a user return to a previous configuration? Undo, history, saved states, presets?

## 1.4 Resolution, export, and color

19. What is the maximum output resolution in practice, on what hardware, and how long does a max-res export take?
20. What file formats can you export? Bit depth?
21. Is there any color management? ICC profiles, wide gamut, working color space?
22. Does the export path preserve the source image's color characteristics, or does it round-trip through sRGB 8-bit?
23. Is there any metadata written into the output? You mentioned filenames encoding settings. Is that still true?
24. Batch anything? Multiple exports, multiple crops, multiple forms from one setup?

## 1.5 Motion

25. What parameters are keyframable? All of them, or a subset?
26. What does the animation editor let you do that a generic keyframe editor would not?
27. How do you get a seamless loop? Is that automatic, manual, or not solved?
28. What are the video export options: format, codec, resolution, frame rate, duration limits?
29. Can you import video as a source? What formats, and does it handle ProRes?
30. What is the render time for, say, a 10-second 4K loop?
31. Is there any procedural or generative motion, or is it purely keyframe-driven? (LFOs, noise, drift)

## 1.6 Live and camera

32. What is the actual measured latency from camera to output? On which device?
33. What resolution does the live camera path run at, and what is the frame rate ceiling?
34. Front and rear camera, multiple cameras, external cameras? Capture cards?
35. What is currently working for output: Syphon, NDI, virtual camera, HDMI, AirPlay? What is shipped versus prototyped?
36. What MIDI mapping exists today? How deep does it go?
37. Any audio reactivity today, or is that entirely forward-looking?
38. What is the DMX build doing?
39. What happens if something goes wrong mid-performance? Does it recover, freeze, or crash?
40. Could this run unattended for eight hours? What would break first?

## 1.7 Platform matrix

41. What actually runs where today? Web, Electron on Mac, Capacitor on iPad, Capacitor on iPhone. Which of those are real builds versus intentions?
42. Which features are platform-locked, and why?
43. Where does performance differ meaningfully by platform?
44. What is the minimum viable device, and where does it start to feel bad?

## 1.8 The moat questions

45. Name the three hardest technical problems you solved. Not the most time-consuming, the hardest.
46. Which of those would a competent developer with an LLM reproduce in a weekend, and which would take them months?
47. What do you know about this problem space that took you a year to learn?
48. Is there anything in the build that you would be genuinely unhappy to see copied?
49. What is currently fragile or held together with tape, that a buyer would discover in week two?

---

# Part 2: what you have already observed

This is the section that will pay the most immediate dividends. You have been running informal research for months. Extracting it is cheaper than running new sessions.

## 2.1 The roster

50. List every person who has used it, with: their name, what they do, what device they were on, roughly how long they spent, and whether you were watching.
51. Which of them asked to use it again? Which of them actually did?
52. Which of them have you not followed up with, and why not?

## 2.2 The first sixty seconds

53. For each person: what did they do first, without prompting?
54. Did they reach for the camera or for an existing image? Was that a choice they made, or did the interface decide for them?
55. How long until their first output that they seemed happy with?
56. How long until their first output that made them react audibly?
57. Did anyone produce something ugly and stop? What happened right before that?

## 2.3 The light-up moment

58. Describe, as concretely as you can, the moment someone lit up. What was on screen? What had they just done?
59. Was it the same moment for different people, or different moments?
60. Was it the image, the motion, the manipulation, or the surprise?
61. Did anyone light up more than once in a session, or was it a single peak?
62. Did the reaction decay within the session? How long did they keep going?

## 2.4 The stuck moments

63. What are the top three places people get stuck, ranked by frequency?
64. What are the top three places people get stuck, ranked by how badly it derails them? (These lists are usually different, and the difference is important.)
65. What did you find yourself explaining out loud, every single time?
66. Which control did people misinterpret? What did they think it did?
67. Did anyone break something, produce a black screen, or get into a state they could not get out of?

## 2.5 The discovery loop

This tests your load-bearing differentiator directly.

68. Did anyone, unprompted, move the source region and realize they could get many different outputs from one image? How many out of how many?
69. If they did, what tipped them off? If they didn't, what did they do instead?
70. Did anyone go back to a source image they had already used, to get something else out of it?
71. Did anyone bring their own image? Whose idea was that?

## 2.6 What they said

Vocabulary mining. This directly feeds positioning copy.

72. Write down the exact words people used to describe what they were seeing. Not paraphrases. Their words.
73. What did they compare it to? "It's like ___."
74. What did they call the thing they made?
75. What did they call the software, or the action they were performing?
76. Did anyone use the word "kaleidoscope" unprompted? Did anyone use it in a way that felt limiting?

## 2.7 The tells

77. Did anyone ask "can I ___?" Write down every one of those questions. That list is your roadmap.
78. Did anyone ask to save, send, or share? What did they want to do with the output?
79. Did anyone ask what it costs, or when they could get it, or whether they could have it now?
80. Did anyone ask if it could do something for a specific project of theirs? What was the project?
81. Whose reaction surprised you?
82. Whose reaction disappointed you, or was more muted than you expected?
83. Did anyone politely disengage? What do you think actually happened there?

---

# Part 3: positioning, pricing, and packaging

Forced choices. The point is not to be right. The point is to commit to something specific enough to be wrong about.

## 3.1 The one sentence

84. Complete, in one sentence, no clauses: "Fold is ___."
85. Now complete it for a photographer who has never heard of it.
86. Now for a festival production designer.
87. Now for someone's mother.
88. Are those four the same product? If not, which one is the real one?

## 3.2 Segments, ranked four ways

Take your segment list (Explorer, Photographer, Pattern designer, Motion designer, VJ, Event producer, Museum, Educator, Artist, plus anyone else you want to add). Rank them separately on each of these. Do not try to make the rankings agree.

89. **Conviction**: which do you most believe will pay?
90. **Access**: which can you reach fastest, through people you already know?
91. **Revenue per customer**: which is worth the most?
92. **Effort to serve**: which requires the least new work to satisfy?
93. Now look at where the rankings diverge. Where a segment is high on conviction and low on access, that is a marketing problem. High on revenue and low on effort is where you start. Write one sentence on what the divergences tell you.

## 3.3 The narrowing

94. If you could only serve one segment for the next three years, which one, and what would you cut?
95. Which segment are you most emotionally attached to for reasons that are not strategic? Be honest.
96. Which segment on the list is there because it sounded good in a brainstorm rather than because you have evidence?

## 3.4 What Fold is not

97. Write ten sentences beginning "Fold is not ___." Include at least three that hurt a little.
98. What would you refuse to build even if a paying customer asked?
99. What feature request have you already received that you decided against? Why?

## 3.5 Price

100. What is the most you have personally paid for a piece of creative software, and what convinced you?
101. What software do you pay for monthly right now, and which of those do you resent?
102. Name the price you would charge if you were certain nobody would balk.
103. Name the price at which you would be embarrassed to charge more.
104. If Fold were free forever, what would you regret?
105. If Fold were $299 and sold 200 copies a year, would that be a success or a failure to you? Why?

## 3.6 The exclusivity question

106. Name a specific capability you would keep out of every shipping build and reserve for your own work. If you can't name one, that tells you something.
107. In three years, what percentage of your working time do you want spent on software versus on your own installations and prints?
108. If those two paths conflicted directly, and you had to choose, which do you choose?
109. What is the smallest amount of money that would make the software path worth continuing?

## 3.7 Kill criteria

110. What would you need to see in the next six months to stop working on this?
111. What is the most likely reason this doesn't work, in your honest assessment?
112. Who is most likely to build a competitive version, and how long would it take them?

---

# Part 4: brand and visual identity

Best done in a separate sitting, with a sketchbook nearby. Some of these are deliberately oblique.

## 4.1 Name and architecture

113. `foldworlds.com` is settled. Is the product called Fold, or Fold Worlds? What do you say out loud when someone asks what you're working on?
114. Does "Worlds" change the promise? Your own copy already says "worlds within worlds," so it may be coherent. Say why, or say it's just a URL.
115. What is the relationship between Fold and Curious Imagery, stated in one sentence a stranger would understand?
116. If Fold succeeds and Curious Imagery stays small, are you okay with that? What about the reverse?
117. Are the SKU names real names or placeholders? Wonder, Studio, Live. Do you like them?

## 4.2 Voice

You currently have two voices in your own writing, and they are not the same brand.

- **Voice A** (canonical landing copy): "A playground for visual symmetry. Find the patterns hiding inside any image." Quiet, spacious, gallery-adjacent, confident.
- **Voice B** (the Pete pitch): "Garbage on the ground becomes a cathedral... Take your friends on a psychedelic journey while stone cold sober... scales from a fun party trick to a full mindfuck. How deep do you want to go?" Loud, transgressive, festival, funny.

Both are good writing. They imply different colors, different type, different price points, and different customers.

118. Which one is true? Not which one is more appropriate. Which one is you.
119. Can the other one survive as a secondary register, and where would it live? (Social? Onboarding? Nowhere?)
120. Which voice does a $250 event license want to hear? Which does a $6 App Store impulse buy want to hear?
121. Write one sentence in each voice describing the same feature. Look at them side by side.

## 4.3 Adjectives

122. Five adjectives Fold should be.
123. Five adjectives Fold should never be. (Include the ones you're afraid of.)
124. For each of your five positive adjectives, name a brand that already owns it. If they all point at the same brand, you are describing that brand, not yours.

## 4.4 Company it keeps

125. If Fold were a physical object in a well-curated shop, what object is it, and what does it cost?
126. What five brands, of any kind, would you want Fold shelved next to?
127. What three brands would you be unhappy to be mistaken for?
128. Name a piece of software whose visual identity you admire and would not copy. Why wouldn't you copy it?

## 4.5 Color

129. What color is forbidden? (The obvious trap for a kaleidoscope brand is the rainbow gradient. Say whether you agree.)
130. Does the brand palette need to sit under the output, or beside it? Your actual output is wildly, unpredictably colorful. That is an argument for a near-neutral brand.
131. Is there a color you have unconsciously used across your existing work? Check your VJ output, your prints, your site.
132. Dark UI or light UI, and is that a brand decision or a tool decision?

## 4.6 The mark

133. List every surface the mark must survive: App Store icon, favicon, monochrome, embroidered, projected, printed small on a postcard, animated. Which of these is the hardest constraint?
134. In an App Store grid, what will Fold's icon sit next to? What do those icons look like? What is the shape of the gap?
135. Does the mark need to be legible as "symmetry," or can it be a form that only makes sense once you know the product?
136. Should the mark be symmetrical? (My position: no. A perfectly radial mark will read as generic in the category. Argue with me.)
137. Does the mark move? If you had one second of animation, what does it do?
138. From the noun list I sent: which three territories do you want to sketch first, and which one do you already secretly dislike?

## 4.7 Type

139. What typefaces are you drawn to, unprompted?
140. Is the wordmark lowercase, and does that decision come from taste or from your existing UI convention? (Your app UI uses lowercase labels.)
141. Does the wordmark need to work as "fold" alone, "foldworlds" as one word, or both?

## 4.8 The imagined artifact

142. Describe the launch page as if it already exists. What is above the fold? What is the first thing that moves?
143. Describe the App Store screenshot set. Five images. What is each one?
144. Describe the one image you would use if you could only ever show one.

---

# Part 5: after the dump

Once this is written, three things fall out of it:

- The **don't-knows** become the competitive scan brief and the technical to-do list.
- The **contradictions** become the interview guide. Every place your answers disagree with each other is a place where a user can break the tie.
- The **commitments** become the straw man: one page of positioning, pricing, and packaging stated as fact, which is the thing you put in front of people to be wrong about.

Bring it back messy. Do not clean it up first.
