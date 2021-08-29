const puppeteer = require("puppeteer")
const fs = require("fs")

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getFirstAvailableAppointment(page) {
    const finalResponse = await page.waitForResponse(
        (response) =>
            response.url() ===
            "https://nswhvam.health.nsw.gov.au/api/sn_vaccine_sm/appointment/availability" &&
            response.status() === 200
    )
    const availabilityResponse = await finalResponse.json()
    return availabilityResponse.result.data
        .find(d => d.noOfSlots > 0 && d.available)
}

async function getFirstAppointmentButtonAsync(container) {
    return await container.$(".btn.appointmentSlot")
}

async function submitAsync(page) {
    const button = await page.$("#submitBtn")
    await button.click()
    await ringBellAsync(page)
}

async function ringBellAsync(page) {
    await page.evaluate(async () => {
        const audio = new Audio(
            "https://freesound.org/data/previews/66/66136_606715-lq.mp3"
        )

        async function notifyAsync() {
            // while (true) {
                await audio.play()
            // }
        }

        await notifyAsync()
    })
}

async function tryToGetAppointmentFromCalendarAsync(secondDosisCalendar, page) {
    const buttonsDays = await secondDosisCalendar.$$(
        'button[ng-if="day"]:not([disabled])[aria-pressed="false"]'
    )
    for (const buttonDay of buttonsDays) {
        await buttonDay.click()
        const availableDosis = await getFirstAvailableAppointment(page)
        if (availableDosis) {
            return availableDosis
        }
    }
}

async function findAppointment(page, bookAfterDate, bookBeforeDate) {
    const firstAppointment = await getFirstAvailableAppointment(page)

    if (firstAppointment) {
        const startDate = new Date(firstAppointment.start_date)

        if (startDate > bookAfterDate && startDate < bookBeforeDate) {
            const appointmentButton = await getFirstAppointmentButtonAsync(page)
            await appointmentButton.click()
            let secondDosis = await getFirstAvailableAppointment(page)
            const appointmentContainers = await page.$$(
                ".appointmentContentContainer"
            )
            const secondDosisAppointmentContainer = appointmentContainers[1]
            if (secondDosis) {
                const secondButton = await getFirstAppointmentButtonAsync(
                    secondDosisAppointmentContainer
                )
                await secondButton.click()
                await submitAsync(page)
            } else {
                const calendarContainers = await page.$$(".calendarContainer")
                const secondDosisCalendar = calendarContainers[1]
                secondDosis = await tryToGetAppointmentFromCalendarAsync(
                    secondDosisCalendar,
                    page
                )
                if (secondDosis) {
                    const secondButton = await getFirstAppointmentButtonAsync(
                        secondDosisAppointmentContainer
                    )
                    await secondButton.click()
                    await submitAsync(page)
                }
                let secondPageButton = await secondDosisCalendar.$(
                    "button#goNext:not([disabled])"
                )
                secondPageButton =
                    secondPageButton ||
                    (await secondDosisCalendar.$(
                        "button#goPrevious:not([disabled])"
                    ))

                if (secondPageButton) {
                    await secondPageButton.click()
                    secondDosis = await getFirstAvailableAppointment(page)
                    if (secondDosis) {
                        const secondButton = await getFirstAppointmentButtonAsync(
                            secondDosisAppointmentContainer
                        )
                        await secondButton.click()
                        await submitAsync(page)
                    }
                    secondDosis = await tryToGetAppointmentFromCalendarAsync(
                        secondDosisCalendar,
                        page
                    )
                    if (secondDosis) {
                        const secondButton = await getFirstAppointmentButtonAsync(
                            secondDosisAppointmentContainer
                        )
                        await secondButton.click()
                        await submitAsync(page)
                    }
                }
                await sleep(30000)
            }
        }
    }
}

async function schedule(bookAfter, bookBefore, taskId, nswhvamCookiePath) {
    const browser = await puppeteer.launch({
        headless: false,
        ignoreDefaultArgs: ["--mute-audio"],
        args: ["--autoplay-policy=no-user-gesture-required"],
        defaultViewport: null,
        slowMo: 20,
    })
    const rescheduleUrl = `https://nswhvam.health.nsw.gov.au/vam?id=reschedule_vaccination&taskId=${taskId}`

    const page = await browser.newPage()
    const cookies = JSON.parse(fs.readFileSync(nswhvamCookiePath, "utf-8"))
    await page.setCookie(...cookies)
    await page.goto(rescheduleUrl)

    let appointmentFound = false
    const bookAfterDate = new Date(bookBefore)
    const bookBeforeDate = new Date(bookBefore)

    while (!appointmentFound) {

        try {
            await findAppointment(page, bookAfterDate, bookBeforeDate);

            await sleep(5000)
            await page.reload()
        } catch (e) {
            if (e instanceof puppeteer.errors.TimeoutError) {
                await sleep(30 * 60 * 1000)
            } else {
                throw e
            }
        }
    }

    await browser.close()
}

schedule('Aug 31 2021', 'Sep 20 2021', 'b8e6f0011b1e3810a74ccbb9274bcb19', './nswhvam.health.nsw.gov.au.cookies.json')
// schedule('Aug 31 2021', 'Sep 30 2021', 'cc6bf4451b9e3810a74ccbb9274bcb74', './nswhvam.health.nsw.gov.au.cookies-liz.json')
