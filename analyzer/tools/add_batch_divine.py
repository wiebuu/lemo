"""15 Nov 2026: top devotional ("divine") songs — bhajans, aartis, mantras, Sufi and Gurbani
— resolved to their YouTube Music art tracks like add_batch_nov15, skipping songs Lemody has."""
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("b", Path(__file__).with_name("add_batch_nov15.py"))
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
b.SONGS = [
    # bhajans, aartis and mantras
    ("Shree Hanuman Chalisa", "Hariharan", "hi"), ("Om Jai Jagdish Hare", "Anuradha Paudwal", "hi"),
    ("Jai Ganesh Deva", "Anuradha Paudwal", "hi"), ("Gayatri Mantra", "Anuradha Paudwal", "hi"),
    ("Achyutam Keshavam", "Vikram Hazra", "hi"), ("Shiv Tandav Stotram", "Shankar Mahadevan", "hi"),
    ("Mahamrityunjay Mantra", "Shankar Mahadevan", "hi"), ("Mere Ghar Ram Aaye Hain", "Jubin Nautiyal", "hi"),
    ("Ram Aayenge", "Swati Mishra", "hi"), ("Har Har Shambhu", "Abhilipsa Panda, Jeetu Sharma", "hi"),
    ("Mera Bhola Hai Bhandari", "Hansraj Raghuwanshi", "hi"), ("Shiv Samaa Rahe", "Hansraj Raghuwanshi", "hi"),
    ("Kaun Hai Woh", "Kailash Kher", "hi"), ("Bam Lahari", "Kailash Kher", "hi"),
    ("Namo Namo", "Amit Trivedi", "hi"), ("Deva Shree Ganesha", "Ajay Gogavale", "hi"),
    ("Jai Shri Ram", "Ajay-Atul", "hi"), ("Shankara", "Rahul Vaidya", "hi"),
    ("Hey Ram", "Jagjit Singh", "hi"), ("Ae Malik Tere Bande Hum", "Lata Mangeshkar", "hi"),
    ("Itni Shakti Hamein Dena Data", "Pushpa Pagdhare, Sushma Shrestha", "hi"),
    ("Mangal Bhavan Amangal Hari", "Anup Jalota", "hi"), ("Aisi Lagi Lagan", "Anup Jalota", "hi"),
    ("Radhe Radhe", "Jaya Kishori", "hi"), ("Adharam Madhuram", "Shreya Ghoshal", "hi"),
    ("Shri Krishna Govind Hare Murari", "Jagjit Singh", "hi"), ("Sanson Ki Mala Pe", "Nusrat Fateh Ali Khan", "hi"),
    # Sufi and qawwali
    ("Khwaja Mere Khwaja", "A.R. Rahman", "hi"), ("Arziyan", "Javed Ali, Kailash Kher", "hi"),
    ("Piya Haji Ali", "A.R. Rahman", "hi"), ("Bhar Do Jholi Meri", "Adnan Sami", "hi"),
    ("Maula Mere Maula", "Roop Kumar Rathod", "hi"), ("Allah Hoo", "Nusrat Fateh Ali Khan", "hi"),
    # Gurbani / Punjabi
    ("Ik Onkar", "Harshdeep Kaur", "pa"), ("Deh Shiva Bar Mohe", "Harshdeep Kaur", "pa"),
    # English
    ("Hallelujah", "Jeff Buckley", "en"), ("Amazing Grace", "Chris Tomlin", "en"),
]
b.main(sys.argv[1])
