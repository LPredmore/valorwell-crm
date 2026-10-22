function escapeInterviewHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Applicant interview messages are necessary recruiting communication, not marketing.
export function interviewInvitationEmailContent(
  applicant: { first_name: string },
  step: "initial_email" | "interview_followup_2" | "interview_followup_3",
) {
  const first = applicant.first_name.trim() || "there";
  const link = "https://valorwell.org/clinicians/interview";
  const invitation = "Enter the same email address you used on your application to access the scheduler.";
  const copy = step === "initial_email"
    ? {
      subject: "Thank you for applying to ValorWell",
      paragraphs: [
        "Hi " + first + ",",
        "Thank you for applying to ValorWell. I'd appreciate the chance to meet you and learn more about your experience.",
        "Please choose a time for a one-hour interview here: " + link,
        invitation,
        "Looking forward to speaking with you,",
        "Luke",
      ],
    }
    : step === "interview_followup_2"
    ? {
      subject: "Following up on your ValorWell application",
      paragraphs: [
        "Hi " + first + ",",
        "I wanted to follow up because we're still interested in interviewing you about joining ValorWell.",
        "If you'd like to meet, please schedule a one-hour interview here: " + link,
        invitation,
        "Hope to connect soon,",
        "Luke",
      ],
    }
    : {
      subject: "One last note about your ValorWell application",
      paragraphs: [
        "Hi " + first + ",",
        "We're still interested in speaking with you, but I understand this may not be the right time.",
        "This will be my last follow-up. We won't continue reaching out, but you're welcome to reconnect whenever you're ready.",
        "You can book an interview at any time using this link: " + link,
        invitation,
        "Wishing you the best,",
        "Luke",
      ],
    };
  const html = copy.paragraphs.map((paragraph) =>
    "<p>" + escapeInterviewHtml(paragraph).replace(link, '<a href="' + link + '">' + link + "</a>") + "</p>"
  ).join("");
  return { subject: copy.subject, html, text: copy.paragraphs.join("\n\n") };
}

