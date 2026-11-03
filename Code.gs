/**
 * ============================================================================
 * 📊 GM Management & Branch Analytics Dashboard - Google Apps Script (Code.gs)
 * ============================================================================
 * ระบบ Backend API เชื่อมต่อ Google Sheets สด 100% สำหรับ:
 * 1. ข้อมูลผู้จัดการ 12 ท่าน ([ชื่อผู้จัดการ] - Meeting, ReportGM, Problem List)
 *    - รองรับการดึงคอลัมน์ H (row[7]: เนื้อหา/รายละเอียดปัญหา)
 *    - รองรับการดึงคอลัมน์ I (row[8]: การแก้ไขปัญหา)
 * 2. ข้อมูลการเบิกจ่ายบัญชี (Dashboard This month)
 * 3. ส่งออก JSON สำหรับ Web Dashboard API (?action=api&period=0|1|2)
 * ============================================================================
 */

const GM_SPREADSHEET_ID = '1ZVxDG93kElikrhKxvMplHFrzBbwYAEvdf3RawZbuNvI';
const ACCOUNTING_SPREADSHEET_ID = '1x8UOs8AEurWr_FGjdUOMUOQ_P3_AQjOVflbKd9H4vd0';

const MANAGERS = [
  'กาญจน์', 'นัท', 'ซอฟ', 'ลูกกุ้ง', 'อัจ', 'รัตน์',
  'อี้', 'หมิว', 'จาเน่', 'โชว์', 'เปีย', 'ส้มโอ'
];

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

/**
 * Web App Entry Point (GET Request)
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
    const period = (e && e.parameter && e.parameter.period !== undefined) ? parseInt(e.parameter.period, 10) : 0;

    if (action === 'api') {
      const data = getAllDashboardData(period);
      const output = {
        status: 'success',
        cached: false,
        timestamp: new Date().toISOString(),
        data: data
      };
      return ContentService.createTextOutput(JSON.stringify(output))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('GM Management & Branch Analytics Dashboard')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');

  } catch (err) {
    const errOutput = {
      status: 'error',
      message: err.toString(),
      stack: err.stack
    };
    return ContentService.createTextOutput(JSON.stringify(errOutput))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * ดึงข้อมูลรวมทั้งระบบ (GM Reports + Problem List [พร้อมคอลัมน์ H, I] + Accounting)
 */
function getAllDashboardData(periodIndex) {
  const idx = (periodIndex === 0 || periodIndex === 1 || periodIndex === 2) ? periodIndex : 0;
  const gmSs = SpreadsheetApp.openById(GM_SPREADSHEET_ID);

  const periodTitles = ['1-10', '11-20', '21-31'];
  const now = new Date();
  const monthIdx = now.getMonth();
  const monthName = THAI_MONTHS[monthIdx] || 'ตุลาคม';
  const yearTh = now.getFullYear() + 543;

  const periodInfo = {
    index: idx,
    title: periodTitles[idx],
    month: monthIdx,
    monthName: monthName,
    yearTh: yearTh,
    displayText: monthName + ' ' + yearTh + ' (รอบ ' + periodTitles[idx] + ')'
  };

  const managersData = [];
  const allProblems = [];
  const uniqueBranchesSet = {};
  var totalMeetingsDone = 0;
  const kpiStatusCount = { green: 0, yellow: 0, red: 0, pending: 0 };

  MANAGERS.forEach(function(mgrName) {
    const mgrInfo = {
      manager: mgrName,
      actualMeetings: 0,
      expectedMeetings: 8,
      meetingDates: [],
      compliance: 0,
      meetingStatus: 'red',
      branches: [],
      allBranchNames: [],
      problemsByBranch: {},
      busStatus: 'pending',
      totalProblems: { red: 0, yellow: 0, purple: 0, normal: 0, total: 0 }
    };

    // 1. ข้อมูลการประชุม: [ชื่อผู้จัดการ] - Meeting
    try {
      const meetSheet = gmSs.getSheetByName(mgrName + ' - Meeting');
      if (meetSheet) {
        const meetValues = meetSheet.getDisplayValues();
        const dates = [];
        for (var i = 1; i < meetValues.length; i++) {
          const cellVal = meetValues[i][0] ? String(meetValues[i][0]).trim() : '';
          if (cellVal !== '') {
            dates.push(cellVal);
          }
        }
        mgrInfo.meetingDates = dates;
        mgrInfo.actualMeetings = dates.length;
        mgrInfo.compliance = Math.round((dates.length / mgrInfo.expectedMeetings) * 100);
        mgrInfo.meetingStatus = (mgrInfo.actualMeetings >= mgrInfo.expectedMeetings) ? 'green' : 'red';
        totalMeetingsDone += dates.length;
      }
    } catch (e) {}

    // 2. ข้อมูลปัญหา: [ชื่อผู้จัดการ] - Problem List (ดึงครบทั้งคอลัมน์ A ถึง I)
    try {
      const probSheet = gmSs.getSheetByName(mgrName + ' - Problem List');
      if (probSheet) {
        const probValues = probSheet.getDisplayValues();
        // แถวที่ 0 คือ Header:
        // Col A (0): ลำดับ
        // Col B (1): สาขา
        // Col C (2): ความเร่งด่วน
        // Col D (3): ต้องการ GM ช่วยเหลือ
        // Col E (4): สถานะ
        // Col F (5): หมวดหมู่
        // Col G (6): หัวข้อ
        // Col H (7): เนื้อหา / รายละเอียดปัญหา  <-- ดึงจากคอลัมน์ H
        // Col I (8): การแก้ไขปัญหา           <-- ดึงจากคอลัมน์ I
        for (var r = 1; r < probValues.length; r++) {
          const row = probValues[r];
          const branch = row[1] ? String(row[1]).trim() : '';
          const status = row[4] ? String(row[4]).trim() : 'กำลังติดตาม';

          if (!branch || status === 'ปิดแล้ว') continue;

          const urgencyRaw = row[2] ? String(row[2]).trim() : 'ทั่วไป';
          var urgency = 'ทั่วไป';
          var urgencyType = 'normal';
          if (urgencyRaw.indexOf('Critical') > -1 || urgencyRaw.indexOf('วิกฤต') > -1) {
            urgency = 'Critical'; urgencyType = 'critical';
          } else if (urgencyRaw.indexOf('High') > -1 || urgencyRaw.indexOf('สูง') > -1) {
            urgency = 'High'; urgencyType = 'high';
          } else if (urgencyRaw.indexOf('Overdue') > -1 || urgencyRaw.indexOf('เกินกำหนด') > -1) {
            urgency = 'Overdue'; urgencyType = 'overdue';
          }

          const needsGmHelp = row[3] ? String(row[3]).trim() : '-';
          const isNeedGm = (needsGmHelp !== '-' && needsGmHelp !== '' && needsGmHelp !== 'ไม่มี');
          const category = row[5] ? String(row[5]).trim() : 'ทั่วไป';
          const subject = row[6] ? String(row[6]).trim() : '(ไม่ได้ระบุหัวข้อ)';

          // ✅ ดึงคอลัมน์ H (index 7) และ คอลัมน์ I (index 8) โดยตรงจาก Google Sheet
          const colHText = (row.length > 7 && row[7] !== undefined) ? String(row[7]).trim() : '';
          const colIText = (row.length > 8 && row[8] !== undefined) ? String(row[8]).trim() : '';

          allProblems.push({
            manager: mgrName,
            branch: branch,
            urgency: urgency,
            urgencyType: urgencyType,
            needsGmHelp: needsGmHelp,
            isNeedGm: isNeedGm,
            status: status,
            category: category,
            subject: subject,
            colH: colHText,
            colI: colIText,
            content: colHText,
            solution: colIText,
            'เนื้อหา': colHText,
            'การแก้ไขปัญหา': colIText,
            problemDetail: colHText || '-',
            initialFix: colIText || '-'
          });

          if (!mgrInfo.problemsByBranch[branch]) {
            mgrInfo.problemsByBranch[branch] = { red: 0, yellow: 0, purple: 0, normal: 0, total: 0 };
          }
          if (urgency === 'Critical') {
            mgrInfo.problemsByBranch[branch].red++;
            mgrInfo.totalProblems.red++;
          } else if (urgency === 'High') {
            mgrInfo.problemsByBranch[branch].yellow++;
            mgrInfo.totalProblems.yellow++;
          } else if (urgency === 'Overdue') {
            mgrInfo.problemsByBranch[branch].purple++;
            mgrInfo.totalProblems.purple++;
          } else {
            mgrInfo.problemsByBranch[branch].normal++;
            mgrInfo.totalProblems.normal++;
          }
          mgrInfo.problemsByBranch[branch].total++;
          mgrInfo.totalProblems.total++;
        }
      }
    } catch (e) {}

    // 3. ข้อมูล KPI สาขา: [ชื่อผู้จัดการ] - ReportGM
    try {
      const rptSheet = gmSs.getSheetByName(mgrName + ' - ReportGM');
      if (rptSheet) {
        const rptValues = rptSheet.getDisplayValues();
        mgrInfo.branches = parseReportGmBranches(rptValues, idx, mgrName, mgrInfo.problemsByBranch, kpiStatusCount);
        mgrInfo.allBranchNames = mgrInfo.branches.map(function(b) {
          uniqueBranchesSet[b.name] = true;
          return b.name;
        });

        var hasRed = mgrInfo.branches.some(function(b) { return b.status === 'red'; });
        var hasYellow = mgrInfo.branches.some(function(b) { return b.status === 'yellow'; });
        var hasGreen = mgrInfo.branches.some(function(b) { return b.status === 'green'; });
        if (hasRed) mgrInfo.busStatus = 'red';
        else if (hasYellow) mgrInfo.busStatus = 'yellow';
        else if (hasGreen) mgrInfo.busStatus = 'green';
      }
    } catch (e) {}

    managersData.push(mgrInfo);
  });

  const critCount = allProblems.filter(function(p) { return p.urgency === 'Critical'; }).length;
  const highCount = allProblems.filter(function(p) { return p.urgency === 'High'; }).length;
  const overdueCount = allProblems.filter(function(p) { return p.urgency === 'Overdue'; }).length;
  const normalCount = allProblems.filter(function(p) { return p.urgency === 'ทั่วไป'; }).length;

  const totalMeetingsExpected = MANAGERS.length * 8;
  const meetingComplianceAvg = totalMeetingsExpected > 0
    ? Math.round((totalMeetingsDone / totalMeetingsExpected) * 100)
    : 0;

  return {
    periodInfo: periodInfo,
    gmReport: {
      summary: {
        totalManagers: MANAGERS.length,
        totalBranches: Object.keys(uniqueBranchesSet).length,
        totalMeetingsDone: totalMeetingsDone,
        totalMeetingsExpected: totalMeetingsExpected,
        meetingComplianceAvg: meetingComplianceAvg,
        problems: {
          critical: critCount,
          high: highCount,
          overdue: overdueCount,
          normal: normalCount,
          total: allProblems.length
        },
        kpiStatusCount: kpiStatusCount
      },
      managers: managersData,
      problemsList: allProblems
    },
    accounting: getAccountingData()
  };
}

/**
 * แกะข้อมูล KPI แต่ละสาขาจากชีท [ชื่อผู้จัดการ] - ReportGM
 */
function parseReportGmBranches(values, periodIndex, mgrName, problemsByBranch, kpiStatusCount) {
  const branches = [];
  if (!values || values.length < 2) return branches;

  var currentBranch = null;
  const colOffset = 2 + (periodIndex * 2);

  for (var r = 0; r < values.length; r++) {
    const row = values[r];
    const colA = String(row[0] || '').trim();
    const colB = String(row[1] || '').trim();

    if (colA.indexOf('สาขา') === 0) {
      if (currentBranch) branches.push(currentBranch);
      const bProbs = problemsByBranch[colA] || { red: 0, yellow: 0, purple: 0, normal: 0, total: 0 };
      currentBranch = {
        name: colA,
        manager: mgrName,
        kpis: [],
        status: 'pending',
        problems: bProbs
      };
      continue;
    }

    if (currentBranch && colA !== '') {
      const val = (row.length > colOffset && row[colOffset] !== undefined && String(row[colOffset]).trim() !== '')
        ? String(row[colOffset]).trim()
        : '-';
      const criteria = (row.length > colOffset + 1 && row[colOffset + 1] !== undefined)
        ? String(row[colOffset + 1]).trim()
        : '';

      var status = 'pending';
      if (criteria.indexOf('ไม่เป็นไปตามเป้า') > -1) status = 'red';
      else if (criteria.indexOf('เสี่ยง') > -1) status = 'yellow';
      else if (criteria.indexOf('เป็นไปตามเป้า') > -1) status = 'green';
      else if (val !== '-' && val.indexOf('%') > -1) {
        const m = val.match(/([\d.]+)\s*%/);
        if (m) {
          const pct = parseFloat(m[1]);
          if (pct >= 80) status = 'green';
          else if (pct >= 50) status = 'yellow';
          else status = 'red';
        }
      }

      if (kpiStatusCount && kpiStatusCount[status] !== undefined) {
        kpiStatusCount[status]++;
      }

      var shortTitle = colA;
      if (colA.indexOf('New Case') > -1 || colA.indexOf('NCM') > -1) shortTitle = 'NRM';
      else if (colA.indexOf('CRM') > -1) shortTitle = 'CRM';

      currentBranch.kpis.push({
        title: shortTitle,
        rawTitle: colA,
        subTitle: colB,
        value: val,
        criteria: criteria,
        status: status
      });

      if (colA.indexOf('Target Revenue') > -1 && status !== 'pending') {
        currentBranch.status = status;
      }
    }
  }

  if (currentBranch) branches.push(currentBranch);
  return branches;
}

/**
 * ดึงข้อมูลการเบิกจ่ายบัญชีจาก Spreadsheet บัญชี (Dashboard This month)
 */
function getAccountingData() {
  const defaultAcc = {
    title: 'รายงานการเบิกประจำเดือน',
    totalAmount: 0,
    branchesCount: 0,
    branchList: [],
    dailyList: [],
    details: []
  };

  try {
    const accSs = SpreadsheetApp.openById(ACCOUNTING_SPREADSHEET_ID);
    const sheet = accSs.getSheetByName('Dashboard This month');
    if (!sheet) return defaultAcc;

    const values = sheet.getDisplayValues();
    if (values.length < 2) return defaultAcc;

    var total = 0;
    const details = [];
    const branchMap = {};
    const dailyMap = {};

    for (var r = 1; r < values.length; r++) {
      const row = values[r];
      const branch = row[1] ? String(row[1]).trim() : '';
      const dateVal = row[2] ? String(row[2]).trim() : '';
      const expName = row[3] ? String(row[3]).trim() : '';
      const rawAmt = row[4] ? String(row[4]).replace(/,/g, '').trim() : '0';
      const amt = parseFloat(rawAmt) || 0;

      if (!branch || amt <= 0) continue;

      total += amt;

      if (!branchMap[branch]) branchMap[branch] = { branch: branch, totalAmount: 0, itemsCount: 0 };
      branchMap[branch].totalAmount += amt;
      branchMap[branch].itemsCount += 1;

      const dayNum = parseInt(dateVal.replace(/[^0-9]/g, ''), 10) || 0;
      const dayKey = dayNum > 0 ? String(dayNum) : dateVal;
      if (dayKey) {
        if (!dailyMap[dayKey]) dailyMap[dayKey] = { date: dayKey, sortableDate: dayKey, totalAmount: 0, count: 0 };
        dailyMap[dayKey].totalAmount += amt;
        dailyMap[dayKey].count += 1;
      }

      details.push({
        id: details.length + 1,
        branch: branch,
        date: dayKey,
        sortableDate: dayKey,
        name: expName,
        amount: amt
      });
    }

    const branchList = Object.keys(branchMap).map(function(k) { return branchMap[k]; })
      .sort(function(a, b) { return b.totalAmount - a.totalAmount; });

    const dailyList = Object.keys(dailyMap).map(function(k) { return dailyMap[k]; })
      .sort(function(a, b) { return parseInt(a.sortableDate, 10) - parseInt(b.sortableDate, 10); });

    return {
      title: defaultAcc.title,
      totalAmount: total,
      branchesCount: branchList.length,
      branchList: branchList,
      dailyList: dailyList,
      details: details
    };
  } catch (e) {
    return defaultAcc;
  }
}
