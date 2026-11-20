import type { ComplianceLetterKey, LetterBlock, LetterContent, LetterValues } from '@tdm/shared'

/**
 * Wording of the declaration letters, carried over from the original TMS.
 * Each letter is printed on the bidding company's letterhead and ends with
 * "Thanking You," and the signatory block.
 */

export interface LetterData {
  companyName: string
  companyAddress: string
  companyGstin: string
  companyPan: string
  companyEmail: string
  companyPhone: string
  signatoryName: string
  designation: string
  authorizedPerson: string
  authorizedPosition: string
  localContentPercent: string
  localValueLocation: string
  buyerOrganization: string
  departmentAddress: string
  tenderRef: string
  tenderBrief: string
  /** DD-MM-YYYY in the client's time zone. */
  date: string
}

export type Block = LetterBlock

export interface Letter {
  title: string
  subtitle?: string
  /** Date printed above the title (some formats put it there). */
  dateAtTop?: boolean
  /** "To," block with the buyer organization and department address. */
  addressed?: boolean
  body: (d: LetterData) => Block[]
}

const or = (s: string, fallback = '________') => s.trim() || fallback

export const LETTERS: Record<ComplianceLetterKey, Letter> = {
  tender_acceptance: {
    title: 'Tender Acceptance Undertaking',
    subtitle: '(To be submitted on letterhead of tenderer)',
    addressed: true,
    body: (d) => [
      {
        kind: 'fields',
        rows: [
          ['Tender Ref No.', or(d.tenderRef, 'N/A')],
          ['Date', d.date],
          ['Name of work/services', or(d.tenderBrief)],
        ],
      },
      { kind: 'para', text: 'Dear Sir/Madam,' },
      {
        kind: 'numbered',
        items: [
          'I/We have downloaded/obtained the tender documents for the above-mentioned tender work.',
          'I/We hereby certify that I/We have read the entire terms and conditions of the tender documents including all Annexure/schedule etc. which form the part of the contract/agreement and I/we shall abide hereby the terms, conditions and clauses contained therein.',
          "The corrigendum's issued from time to time by your center have also been taken into consideration, while submitting this acceptance letter.",
          'I/We hereby unconditionally accept the tender conditions of above-mentioned tender document/corrigendum in its totality/entirety.',
          'I/We certify that all information furnished by our firm is true and correct and, in the event that the information is found to be incorrect/untrue or found violated, then your center shall without giving any notice or reason therefor summarily reject the bid or terminate the contract.',
        ],
      },
    ],
  },

  blacklisting: {
    title: 'UNDERTAKING REGARDING BLACKLISTING / NON-DEBARMENT',
    addressed: true,
    body: (d) => [
      {
        kind: 'para',
        text: `We hereby confirm and declare that we, ${d.companyName}, are not blacklisted/de-registered/debarred by any Government department/Public Sector Undertaking/Private Sector or any other agency for which we have executed/undertaken the works/services during the last 5 years.`,
      },
    ],
  },

  make_in_india: {
    title: "Self-Certification under Preference to 'MAKE IN INDIA' Policy",
    body: (d) => [
      {
        kind: 'para',
        text: `In line with Government Public Procurement Order No. P-45021/2/2017-BE-II dt. 15.06.2017, as amended from time to time and as applicable on the date of submission of tender, we hereby certify that we M/s ${d.companyName} are local supplier meeting the requirement of minimum local content (${or(d.localContentPercent)}%) as defined in above orders for the material against Tender No ${or(d.tenderRef)}.`,
      },
      {
        kind: 'para',
        text: `Details of location at which local value addition will be made is as follows: ${or(d.localValueLocation)}`,
      },
      {
        kind: 'para',
        text: 'We also understand, false declarations will be in breach of the Code of Integrity under Rule 175(1)(i)(h) of the General Financial Rules for which a bidder or its successors can be debarred for up to two years as per Rule 151 (iii) of the General Financial Rules along with such other actions as may be permissible under law.',
      },
    ],
  },

  minimum_wage: {
    title: 'Undertaking regarding acceptance of minimum wage policy',
    addressed: true,
    body: () => [
      {
        kind: 'para',
        text: 'It is hereby confirmed that we have fully complied with all the provisions of all Labour and Industrial Laws as applicable to the workers engaged by us for the above work and we have also paid them wages not less than the minimum wages under the relevant laws.',
      },
    ],
  },

  land_border: {
    title: 'Land Border Sharing Declaration',
    subtitle: "(To be submitted on the bidder's letter head)",
    body: (d) => [
      {
        kind: 'para',
        text: "In line with Department of Expenditure's (DoE) Public Procurement Division Order vide ref. F.No.6/18/2019-PPD dated 23.07.2020 & 24.07.2020",
      },
      { kind: 'fields', rows: [['Tender No', or(d.tenderRef)]] },
      {
        kind: 'para',
        text: `"I/We have read the clauses pertaining to Department of Expenditure's (DoE) Public Procurement Division Order (Public procurement no 1, 2 & 3 vide ref. F.No.6/18/2019-PPD dated 23.07.2020 & 24.07.2020) regarding restrictions on procurement from a bidder of a country which shares a land border with India. I/We hereby certify that I/we the bidder ${d.companyName} is/are`,
      },
      {
        kind: 'para',
        text: 'a) Not from such a country and eligible to be considered for this tender.',
      },
      { kind: 'center', text: 'OR' },
      {
        kind: 'para',
        text: 'b) From such country, has been registered with the competent authority and eligible to be considered for this tender. (Evidence of valid registration by the competent authority shall be attached)"',
      },
    ],
  },

  no_relative: {
    title: 'Undertaking for Tender - Confirmation of No Relative in Tendering Authority',
    addressed: true,
    body: (d) => [
      {
        kind: 'fields',
        rows: [
          ['Tender Reference No', or(d.tenderRef)],
          ['Name of Work', or(d.tenderBrief)],
        ],
      },
      { kind: 'para', text: `I/We, ${d.companyName}, hereby undertake and declare that:` },
      {
        kind: 'bullets',
        items: [
          'I/We have read and understood the tender requirements and conditions, and hereby confirm that I/We meet all the necessary criteria and qualifications for the tender.',
          'I/We hereby declare that I/We have no relative(s) in the tendering authority or in any other organization that is involved in the evaluation, selection, or award of this tender.',
          'I/We acknowledge that providing false or misleading information in this undertaking may result in disqualification from the tender process, and may lead to legal action against me/us.',
        ],
      },
    ],
  },

  power_of_attorney: {
    title: 'Power of Attorney',
    addressed: true,
    body: (d) => {
      const dept = or(d.buyerOrganization, 'the tendering authority')
      return [
        {
          kind: 'para',
          text: `KNOW ALL MEN BY THESE PRESENTS that we, ${d.companyName}, a company/organization duly organized and existing under the laws of India, with its principal office at ${d.companyAddress}, do hereby constitute, appoint and authorize Mr./Ms. ${or(d.authorizedPerson)}, who is presently employed with us and holding the position of ${or(d.authorizedPosition)}, as our attorney-in-fact, to act for us and in our name, place and stead, with respect to the following matters:`,
        },
        {
          kind: 'bullets',
          items: [
            `To provide information and responses to ${dept}, and to attend meetings and negotiations with ${dept} and any other third parties relating to the bid.`,
            `To receive notices, letters and other communications from ${dept} and to represent us in all matters concerning the tender for the said work.`,
          ],
        },
        {
          kind: 'para',
          text: 'We hereby agree to ratify and confirm all acts, deeds and things lawfully done by our said attorney pursuant to this Power of Attorney and that all acts, deeds and things done by our aforesaid attorney shall and shall always be deemed to have been done by us.',
        },
        {
          kind: 'para',
          text: 'This Power of Attorney shall be valid and effective from the date of execution and shall continue until the completion of the said work or until revoked by us in writing.',
        },
        {
          kind: 'para',
          text: `IN WITNESS WHEREOF, we have executed this Power of Attorney on ${d.date}.`,
        },
      ]
    },
  },

  bid_security: {
    title: 'Bid Security Declaration',
    subtitle: "(On Bidder's Letter Head)",
    dateAtTop: true,
    body: (d) => [
      {
        kind: 'para',
        text: `I/We, the authorized signatory of M/s ${d.companyName}, participating in the subject Tender No: ${or(d.tenderRef)} for the job of ${or(d.tenderBrief)}, do hereby declare that in the event:`,
      },
      { kind: 'para', text: 'I/We withdraw/modify our bid during the period of bid validity' },
      { kind: 'center', text: 'OR' },
      {
        kind: 'para',
        text: 'I/We commit any other breach of tender conditions/contract which would have otherwise attracted forfeiture of EMD',
      },
      { kind: 'center', text: 'OR' },
      {
        kind: 'para',
        text: 'I/We fail to/refuse to initiate the execution of the awarded Contract as per the terms of the Contract then I/We could be suspended from being eligible for bidding/award of all future tender(s) for a period as applicable per the Incident Management Policy of GeM.',
      },
    ],
  },

  no_litigation: {
    title: 'Declaration of No Pending Litigation',
    body: (d) => [
      {
        kind: 'para',
        text: `I, ${d.signatoryName}, do hereby solemnly affirm and declare as follows:`,
      },
      {
        kind: 'numbered',
        items: [
          `I am the ${d.designation} of the firm/company known as ${d.companyName} having its registered office at ${d.companyAddress}.`,
          `I hereby certify that, as of ${d.date}, there are no arbitration or litigation cases pending or initiated against ${d.companyName} in any court, tribunal, or arbitration proceedings.`,
          `I further declare that there are no legal disputes, claims, or controversies that could potentially lead to arbitration or litigation against ${d.companyName}.`,
          'I understand the importance of providing accurate and truthful information, and I affirm that the statements made in this affidavit are true and correct to the best of my knowledge, information, and belief.',
          `I undertake to promptly inform the relevant parties involved in any project or contract in the event that any arbitration or litigation case is initiated against ${d.companyName}.`,
          'I understand that any false statement in this affidavit may lead to legal consequences, and I am making this affidavit in good faith.',
          `This affidavit is executed on ${d.date}.`,
        ],
      },
    ],
  },

  non_bankruptcy: {
    title: 'DECLARATION OF NON-BANKRUPTCY',
    dateAtTop: true,
    addressed: true,
    body: (d) => [
      { kind: 'fields', rows: [['Subject', 'Declaration of Non-Bankruptcy']] },
      {
        kind: 'para',
        text: `I/We, the undersigned, ${d.companyName} having our registered office at ${d.companyAddress}, do hereby solemnly declare and affirm that:`,
      },
      { kind: 'heading', text: 'Non-Bankruptcy Status:' },
      {
        kind: 'para',
        text: `As of the date of this declaration, ${d.companyName} is not bankrupt, insolvent, or undergoing any bankruptcy, insolvency, or liquidation proceedings under any applicable laws.`,
      },
      { kind: 'heading', text: 'Legal Compliance:' },
      {
        kind: 'para',
        text: `${d.companyName} is not subject to any court proceedings, creditor arrangements, or similar legal actions that may affect our financial standing or ability to fulfill contractual obligations.`,
      },
      { kind: 'heading', text: 'Truthfulness and Accuracy:' },
      {
        kind: 'para',
        text: 'This declaration is made in full honesty, and I/we understand that any false statement or misrepresentation may lead to disqualification from the bidding process and legal consequences.',
      },
      {
        kind: 'para',
        text: 'I/We make this declaration with full understanding and acknowledge that it may be used as evidence of our eligibility to participate in the bidding process.',
      },
      { kind: 'para', text: `Signed on ${d.date} at ${d.companyAddress}.` },
    ],
  },

  non_liquidation: {
    title: 'NON LIQUIDATION DECLARATION',
    addressed: true,
    body: (d) => [
      { kind: 'fields', rows: [['Subject', 'Non Liquidation Declaration']] },
      {
        kind: 'para',
        text: `This is to certify that ${d.companyName} having its registered office at ${d.companyAddress} has never been under liquidation/de-registered/debarred/suspended by any Government department/Public Sector Undertaking/Private Sector or any other agency for which we have executed/undertaken the works/services.`,
      },
      { kind: 'para', text: 'Kindly accept this declaration.' },
    ],
  },

  non_disclosure: {
    title: 'NON-DISCLOSURE DECLARATION',
    dateAtTop: true,
    addressed: true,
    body: (d) => [
      { kind: 'fields', rows: [['Subject', 'Non-Disclosure Declaration']] },
      {
        kind: 'para',
        text: `I/We, the undersigned, on behalf of ${d.companyName}, having our registered office at ${d.companyAddress}, hereby declare that we fully understand and acknowledge that in the course of our participation in the above-referenced tender, we may gain access to confidential and proprietary information, including but not limited to technical specifications, financial details, project documents, evaluation criteria, or other sensitive information (collectively referred to as "Confidential Information").`,
      },
      { kind: 'para', text: 'We hereby undertake and agree to the following:' },
      {
        kind: 'numbered',
        items: [
          'We shall keep all such Confidential Information strictly confidential and shall not disclose, reproduce, or distribute it in any form to any third party without the prior written consent of the procuring entity.',
          'We shall use the Confidential Information solely for the purpose of preparing and submitting our tender offer.',
          'We shall ensure that all personnel or representatives involved in the tender process on our behalf are made aware of and agree to comply with the terms of this declaration.',
        ],
      },
      {
        kind: 'para',
        text: 'This declaration shall remain valid and binding throughout the tender process and, if we are not the successful bidder, shall remain in force after the tender closing date. We acknowledge that a breach of this declaration may result in disqualification from the tender process and/or legal action as deemed appropriate by the procuring entity.',
      },
      {
        kind: 'para',
        text: 'This declaration is made in good faith and is duly authorized by the undersigned representative of the bidder.',
      },
    ],
  },
}

/** The values for {{field}} fill-ins in the client's own letters. */
export function letterValues(d: LetterData): LetterValues {
  return {
    company_name: d.companyName,
    company_address: d.companyAddress,
    company_gstin: d.companyGstin,
    company_pan: d.companyPan,
    company_email: d.companyEmail,
    company_phone: d.companyPhone,
    signatory_name: d.signatoryName,
    designation: d.designation,
    authorized_person: d.authorizedPerson,
    authorized_position: d.authorizedPosition,
    local_content_percent: d.localContentPercent,
    local_value_location: d.localValueLocation,
    buyer_organization: d.buyerOrganization,
    department_address: d.departmentAddress,
    tender_ref: d.tenderRef,
    tender_brief: d.tenderBrief,
    date: d.date,
  }
}

/** LetterData whose every value is its own {{field}}, to turn a built-in letter into editable text. */
const FIELD_DATA: LetterData = {
  companyName: '{{company_name}}',
  companyAddress: '{{company_address}}',
  companyGstin: '{{company_gstin}}',
  companyPan: '{{company_pan}}',
  companyEmail: '{{company_email}}',
  companyPhone: '{{company_phone}}',
  signatoryName: '{{signatory_name}}',
  designation: '{{designation}}',
  authorizedPerson: '{{authorized_person}}',
  authorizedPosition: '{{authorized_position}}',
  localContentPercent: '{{local_content_percent}}',
  localValueLocation: '{{local_value_location}}',
  buyerOrganization: '{{buyer_organization}}',
  departmentAddress: '{{department_address}}',
  tenderRef: '{{tender_ref}}',
  tenderBrief: '{{tender_brief}}',
  date: '{{date}}',
}

/** A built-in letter as editable text, for "copy and edit". */
export function builtinLetterContent(key: ComplianceLetterKey): LetterContent {
  const l = LETTERS[key]
  return {
    title: l.title,
    subtitle: l.subtitle ?? null,
    addressed: !!l.addressed,
    dateAtTop: !!l.dateAtTop,
    body: l.body(FIELD_DATA),
  }
}
