const repairs = [
    {
        id: '1',
        dateIn: '2023-10-01T10:00:00.000Z',
        dateOut: '2023-10-05T10:00:00.000Z',
        timeline: [
            { status: 'Ingresso', date: '2023-10-01T10:00:00.000Z' },
            { status: 'Diagnosi', date: '2023-10-01T12:00:00.000Z' },
            { status: 'In Lavorazione', date: '2023-10-02T09:00:00.000Z' },
            { status: 'Attesa Parti', date: '2023-10-02T15:00:00.000Z' },
            { status: 'In Lavorazione', date: '2023-10-04T09:00:00.000Z' },
            { status: 'Riparato', date: '2023-10-05T10:00:00.000Z' }
        ]
    }
];

const getDuration = (r, status) => {
    if (!r.timeline || r.timeline.length === 0) return 0;
    let total = 0;
    const now = new Date();
    r.timeline.forEach((entry, i) => {
        if (entry.status === status) {
            const start = new Date(entry.date).getTime();
            const nextEntry = r.timeline[i + 1];
            const end = nextEntry ? new Date(nextEntry.date).getTime() : now.getTime();
            total += (end - start);
        }
    });
    return total;
};

console.log('Test 1 (Diagnosi):', getDuration(repairs[0], 'Diagnosi') / (1000 * 60 * 60), 'hours');
console.log('Test 2 (In Lavorazione):', getDuration(repairs[0], 'In Lavorazione') / (1000 * 60 * 60), 'hours');
console.log('Test 3 (Attesa Parti):', getDuration(repairs[0], 'Attesa Parti') / (1000 * 60 * 60), 'hours');
