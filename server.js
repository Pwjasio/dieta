const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SQL Server configuration
const sqlConfig = {
    user: 'your_username',
    password: 'your_password',
    database: 'your_database',
    server: 'your_server', // e.g., 'localhost' or 'server.domain.com'
    port: 1433, // default SQL Server port
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    options: {
        encrypt: true, // for Azure SQL Database
        trustServerCertificate: true // change to true for local dev / self-signed certs
    }
};

// Initialize database connection
let pool;

async function initializeDatabase() {
    try {
        pool = await sql.connect(sqlConfig);
        console.log('Connected to SQL Server');
        
        // Create table if it doesn't exist
        const createTableQuery = `
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='date_entries' AND xtype='U')
            CREATE TABLE date_entries (
                id INT PRIMARY KEY,
                label NVARCHAR(255),
                timestamp DATETIME2,
                timeToAdd FLOAT,
                created_at DATETIME2 DEFAULT GETDATE(),
                updated_at DATETIME2 DEFAULT GETDATE()
            )
        `;
        
        await pool.request().query(createTableQuery);
        console.log('Database table initialized');
    } catch (err) {
        console.error('Database connection failed:', err);
        process.exit(1);
    }
}

// Routes

// Get all entries
app.get('/api/entries', async (req, res) => {
    try {
        const result = await pool.request().query('SELECT * FROM date_entries ORDER BY id');
        res.json({
            success: true,
            data: result.recordset
        });
    } catch (err) {
        console.error('Error fetching entries:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch entries'
        });
    }
});

// Save all entries
app.post('/api/entries/save', async (req, res) => {
    try {
        const { entries } = req.body;
        
        // Begin transaction
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        try {
            // Clear existing entries
            await transaction.request().query('DELETE FROM date_entries');
            
            // Insert new entries
            for (const entry of entries) {
                const query = `
                    INSERT INTO date_entries (id, label, timestamp, timeToAdd, updated_at)
                    VALUES (@id, @label, @timestamp, @timeToAdd, GETDATE())
                `;
                
                const request = transaction.request();
                request.input('id', sql.Int, entry.id);
                request.input('label', sql.NVarChar, entry.label || '');
                request.input('timestamp', sql.DateTime2, entry.timestamp ? new Date(entry.timestamp) : null);
                request.input('timeToAdd', sql.Float, parseFloat(entry.timeToAdd) || 0);
                
                await request.query(query);
            }
            
            await transaction.commit();
            res.json({
                success: true,
                message: 'Entries saved successfully'
            });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error('Error saving entries:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to save entries'
        });
    }
});

// Update single entry
app.put('/api/entries/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { label, timestamp, timeToAdd } = req.body;
        
        const query = `
            UPDATE date_entries 
            SET label = @label, timestamp = @timestamp, timeToAdd = @timeToAdd, updated_at = GETDATE()
            WHERE id = @id
            
            IF @@ROWCOUNT = 0
            INSERT INTO date_entries (id, label, timestamp, timeToAdd, updated_at)
            VALUES (@id, @label, @timestamp, @timeToAdd, GETDATE())
        `;
        
        const request = pool.request();
        request.input('id', sql.Int, parseInt(id));
        request.input('label', sql.NVarChar, label || '');
        request.input('timestamp', sql.DateTime2, timestamp ? new Date(timestamp) : null);
        request.input('timeToAdd', sql.Float, parseFloat(timeToAdd) || 0);
        
        await request.query(query);
        
        res.json({
            success: true,
            message: 'Entry updated successfully'
        });
    } catch (err) {
        console.error('Error updating entry:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update entry'
        });
    }
});

// Clear all entries
app.delete('/api/entries', async (req, res) => {
    try {
        await pool.request().query('DELETE FROM date_entries');
        res.json({
            success: true,
            message: 'All entries cleared successfully'
        });
    } catch (err) {
        console.error('Error clearing entries:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to clear entries'
        });
    }
});

// Export data
app.get('/api/export', async (req, res) => {
    try {
        const result = await pool.request().query('SELECT * FROM date_entries ORDER BY id');
        const exportData = {
            entries: result.recordset,
            lastSaved: new Date().toISOString(),
            exportDate: new Date().toISOString()
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=timestamp_data_${new Date().toISOString().split('T')[0]}.json`);
        res.json(exportData);
    } catch (err) {
        console.error('Error exporting data:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to export data'
        });
    }
});

// Import data
app.post('/api/import', async (req, res) => {
    try {
        const { entries } = req.body;
        
        if (!entries || !Array.isArray(entries)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid import data format'
            });
        }
        
        // Begin transaction
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        try {
            // Clear existing entries
            await transaction.request().query('DELETE FROM date_entries');
            
            // Insert imported entries
            for (const entry of entries) {
                const query = `
                    INSERT INTO date_entries (id, label, timestamp, timeToAdd, updated_at)
                    VALUES (@id, @label, @timestamp, @timeToAdd, GETDATE())
                `;
                
                const request = transaction.request();
                request.input('id', sql.Int, entry.id);
                request.input('label', sql.NVarChar, entry.label || '');
                request.input('timestamp', sql.DateTime2, entry.timestamp ? new Date(entry.timestamp) : null);
                request.input('timeToAdd', sql.Float, parseFloat(entry.timeToAdd) || 0);
                
                await request.query(query);
            }
            
            await transaction.commit();
            res.json({
                success: true,
                message: 'Data imported successfully'
            });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error('Error importing data:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to import data'
        });
    }
});

// Health check
app.get('/api/health', async (req, res) => {
    try {
        await pool.request().query('SELECT 1');
        res.json({
            success: true,
            message: 'Database connection healthy',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: 'Database connection failed'
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Start server
initializeDatabase().then(() => {
    app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    if (pool) {
        await pool.close();
    }
    process.exit(0);
});