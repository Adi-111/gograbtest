export class MachineDto {
    machine_id: string;
    machine_name: string;
    location: string;
    description: string;
    rating: string;
    machine_status: boolean;
    machine_type: string;
    machine_capacity: number;
    total_coils: number;
    password: string;
    date_created: Date;
    left_units: number;
    last_refill_time: Date;
    last_refill_by: string;
    last_refill_availability: string;
    availability: string;
    last_transaction: Date;
    accumulated_downtime: string;
    time_difference_from_last_transaction: string;
    last_report_time: Date;
    refill_report_time_difference: string;
    variety_score: string;
    latitude: number;
    longitude: number;
}